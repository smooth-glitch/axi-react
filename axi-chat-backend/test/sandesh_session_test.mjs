// Proves the "log in again every two weeks" rule WITHOUT waiting two weeks:
// the backend is started with a short session lifetime, and we watch a
// session expire -- over REST, and on a WebSocket that is already open.
//
//   redis-cli -n 10 FLUSHDB
//   REDIS_DB=10 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   SANDESH_SESSION_TTL_SEC=6 SANDESH_SESSION_CHECK_SEC=2 .\run.ps1 5559 8084
//   node test/sandesh_session_test.mjs [http://localhost:8084]
//
// (The default lifetime, 14 days, is asserted in sandesh_test.mjs.)

const BASE = process.argv[2] || "http://localhost:8084";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + JSON.stringify(detail) : ""}`); }
}
async function api(method, path, body, token) {
    const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
}

async function main() {
    console.log(`Session-expiry test against ${BASE}\n`);
    const admin = `sess${sfx}`;
    let r = await api("POST", "/api/sd/setup/start", { org: "Session Org", name: "Sess Admin", username: admin, email: `${admin}@x.org`, mobile: "+919000000123" });
    if (r.status === 409) { console.log("Database already set up -- flush it and restart the backend, then re-run."); process.exit(2); }
    r = await api("POST", "/api/sd/setup/verify", { otp: r.json.data.devOtp });
    ok("setup works", r.status === 200, r);

    console.log("=== A session ends when its lifetime does (REST) ===");
    // A fresh login gives the token we time everything from.
    r = await api("POST", "/api/sd/login", { identifier: admin, password: `Sandesh${admin}` });
    const loginAt = Date.now();
    const token = r.json.data.token;
    const expiresTs = r.json.data.expiresTs;
    ok("login reports when the session ends (expiresTs ~ now + 6s)", expiresTs - loginAt > 4500 && expiresTs - loginAt < 7500, expiresTs - loginAt);
    r = await api("GET", "/api/sd/session", undefined, token);
    ok("the session is valid now and reports the same end time", r.status === 200 && r.json.data.sessionExpiresTs === expiresTs, r.json);

    console.log("=== A connection opened with it is cut off when it ends (WebSocket) ===");
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    let closedAt = null;
    ws.addEventListener("message", (e) => { try { inbox.push(JSON.parse(e.data)); } catch { /* */ } });
    ws.addEventListener("close", () => { closedAt = Date.now(); });
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ username: admin, token }));           // no armSessionId
    const waitFor = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const h = inbox.find(pred); if (h) return h; await sleep(25); } return null; };
    ok("connects (no armSessionId needed)", !!(await waitFor(m => m.type === "welcome")));
    let seq = 0;
    const sd = async (a) => { const id = `q${++seq}`; ws.send(`/sd ${a} ${JSON.stringify({ reqId: id })}`); return waitFor(m => m.type === "sd" && m.reqId === id, 2500); };
    let m = await sd("me");
    ok("while valid, /sd me is signed in and shows the session end", m?.data?.authenticated === true && m.data.sessionExpiresTs === expiresTs, m);

    // Keep the connection "recently checked" right before expiry, so the next
    // /sd call exercises the per-command path rather than the periodic close.
    await sleep(Math.max(0, expiresTs - Date.now() - 800));
    ws.send("/list");
    await sleep(1100);                                              // session has now ended
    ok("(the session has ended)", Date.now() > expiresTs);
    r = await api("GET", "/api/sd/session", undefined, token);
    ok("REST: the expired token is refused (401)", r.status === 401, r);

    m = await sd("me");
    ok("WS: /sd me now says authenticated:false, sessionExpired:true", m?.data?.authenticated === false && m.data.sessionExpired === true, m);
    m = await sd("assoc.list");
    ok("WS: any signed-in action answers session_expired (not a generic error)", m && m.ok === false && m.error.code === "session_expired", m);

    // The periodic check (every SANDESH_SESSION_CHECK_SEC=2s): the next command
    // after that window closes the connection and tells the UI why.
    await sleep(2300);
    ws.send("/list");
    const ev = await waitFor(m2 => m2.type === "sd_event" && m2.event === "session_expired", 2500);
    ok("WS: the next command after the check window gets sd_event session_expired", !!ev && ev.reason === "two_week_login", ev);
    await sleep(500);
    ok("WS: and the server closes the connection", closedAt !== null || ws.readyState >= 2, ws.readyState);

    console.log("=== Signing in again starts a new session ===");
    r = await api("POST", "/api/sd/login", { identifier: admin, password: `Sandesh${admin}` });
    ok("a fresh login works and gets a NEW token", r.status === 200 && r.json.data.token !== token, r.json);
    r = await api("GET", "/api/sd/session", undefined, r.json.data.token);
    ok("...which is valid", r.status === 200);

    console.log(`\n=== SUMMARY ===\n${pass} passed, ${fail} failed`);
    if (failures.length) console.log("Failures:\n  - " + failures.join("\n  - "));
    try { ws.close(); } catch { /* */ }
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("TEST SCRIPT ERROR:", e); process.exit(2); });
