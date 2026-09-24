// End-to-end test for the Sandesh layer (org setup, users, hosts, approvals,
// host-only messaging, groups, cards, options/forms, admin console) driven
// over REAL HTTP + WebSocket against a running backend in STRICT mode.
//
// Start the backend like this (a scratch Redis DB, never DB 0):
//   REDIS_DB=13 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   CHAT_RATE_LIMIT_MAX=1000 SANDESH_SCHEDULER_TICK_MS=500 .\run.ps1 5557 8082
// and make sure that DB is empty first (the test does a first-run setup,
// which can only happen once per DB):
//   redis-cli -n 13 FLUSHDB
// then:
//   node test/sandesh_test.mjs [http://localhost:8082]
//
// SANDESH_DEV_OTP=1 makes the API echo OTP codes (`devOtp`) so no log
// reading is needed. Uses only Node's built-ins (Node 22+).

const BASE = process.argv[2] || "http://localhost:8082";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc + (detail !== undefined ? ` -- ${detail}` : "")); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- HTTP helpers ---------------------------------------------------------------------------
async function http(method, path, body, token) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
}
const post = (p, b, t) => http("POST", p, b ?? {}, t);
const data = (r) => r.json?.data;
const code = (r) => r.json?.error?.code;

async function loginWithOtp(identifier) {
    const s = await post("/api/sd/otp/send", { identifier });
    const otp = data(s)?.devOtp;
    const r = await post("/api/sd/login", { identifier, otp });
    return { send: s, login: r, token: data(r)?.token, otp };
}

// ---- WebSocket client ---------------------------------------------------------------------------
class Client {
    constructor(name) { this.name = name; this.inbox = []; this.waiters = []; this.seq = 0; this.closed = false; }
    async connect(token, withArm = true) {
        this.ws = new WebSocket(WS_URL);
        this.ws.addEventListener("message", (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch { m = { type: "__raw__", text: ev.data }; }
            this.inbox.push(m);
            for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].pred(m)) { this.waiters[i].resolve(m); this.waiters.splice(i, 1); }
        });
        this.ws.addEventListener("close", () => { this.closed = true; });
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        // armSessionId is optional now (the app has its own login; no ARM session to forward)
        this.ws.send(JSON.stringify({ username: this.name, token: token ?? "fake", ...(withArm ? { armSessionId: "x" } : {}) }));
        return this;
    }
    async ready() { return this.waitFor(m => m.type === "welcome" || m.type === "error", 3000, "handshake result"); }
    send(t) { this.ws.send(t); }
    waitFor(pred, ms = 3000, label = "event") {
        const hit = this.inbox.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (client ${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    // Send "/sd <action> <json>" and resolve with the matching reply envelope.
    async sd(action, args = {}) {
        const reqId = `${this.name}-${++this.seq}`;
        this.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        return this.waitFor(m => m.type === "sd" && m.reqId === reqId, 4000, `reply to ${action}`);
    }
    async event(name, ms = 3000) { return this.waitFor(m => m.type === "sd_event" && m.event === name, ms, `sd_event ${name}`); }
    clear() { this.inbox = []; }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}
async function connectAs(name, token) { const c = new Client(name); await c.connect(token); const r = await c.ready(); c.first = r; return c; }

// =========================================================================================
async function main() {
    console.log(`Sandesh strict-mode test against ${BASE}\n`);

    console.log("=== Public info, CORS, routing ===");
    let r = await http("GET", "/api/sd/public");
    ok("GET /api/sd/public answers 200", r.status === 200 && r.json?.ok === true, r);
    if (data(r)?.setupDone) {
        console.log("\nThis database is already set up. Flush the scratch Redis DB and restart the backend, then re-run.");
        process.exit(2);
    }
    ok("setupDone is false on a fresh DB", data(r).setupDone === false);
    r = await http("OPTIONS", "/api/sd/login");
    ok("CORS preflight returns 204 with allow-origin", r.status === 204 && r.headers.get("access-control-allow-origin") === "*", r.status);
    r = await http("GET", "/api/sd/nonexistent");
    ok("unknown /api/sd route is a JSON 404", r.status === 404 && code(r) === "not_found");
    r = await fetch(BASE + "/api/sd/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    ok("malformed JSON body is a 400, not a crash", r.status === 400, r.status);

    console.log("=== First-run setup ===");
    r = await post("/api/sd/register", { name: "Early Bird", email: `early${sfx}@x.com`, isEmployee: false });
    ok("self-registration before setup is refused (409 not_ready)", r.status === 409 && code(r) === "not_ready", r);
    r = await post("/api/sd/setup/start", { org: "Acme Corp", name: "Root Admin", email: "not-an-email", mobile: "+919886012345" });
    ok("setup/start rejects an invalid email", r.status === 400 && code(r) === "invalid_email", r);
    r = await post("/api/sd/setup/start", { name: "Root Admin", email: `root${sfx}@acme.com`, mobile: "+919886012345" });
    ok("setup/start requires an org name", r.status === 400, r);
    const adminName = `root${sfx}`;
    r = await post("/api/sd/setup/start", { org: "Acme Corp", name: "Root Admin", username: adminName, email: `root${sfx}@acme.com`, mobile: "+919886012345" });
    ok("setup/start sends an OTP (dev echo present)", r.status === 200 && data(r).sent === true && /^\d{6}$/.test(data(r).devOtp ?? ""), r);
    const setupOtp = data(r).devOtp;
    r = await post("/api/sd/setup/verify", { otp: setupOtp === "000000" ? "111111" : "000000" });
    ok("setup/verify rejects a wrong OTP", r.status === 401 && code(r) === "otp_invalid", r);
    r = await post("/api/sd/setup/verify", { otp: setupOtp });
    ok("setup/verify creates the org + first administrator", r.status === 200 && data(r).user?.role === "admin" && !!data(r).token, r);
    const admin = { username: data(r).user.username, token: data(r).token };
    ok("admin's username is the one requested", admin.username === adminName, admin.username);
    ok("first admin must change the default password", data(r).mustChangePassword === true);
    r = await post("/api/sd/setup/start", { org: "Evil Inc", name: "X", email: `x${sfx}@evil.com`, mobile: "+911234567890" });
    ok("a second setup is refused (409 already_setup)", r.status === 409 && code(r) === "already_setup", r);
    r = await http("GET", "/api/sd/public");
    ok("public info now shows the org + seeded categories", data(r).setupDone === true && data(r).org === "Acme Corp" && data(r).categories.includes("Customer") && data(r).categories.includes("Doctor"), data(r));

    console.log("=== Passwords ===");
    r = await post("/api/sd/login", { identifier: adminName, password: `Sandesh${adminName}` });
    ok('default admin password is "Sandesh"+username and logs in', r.status === 200 && data(r).mustChangePassword === true, r);
    const lifetimeDays = (data(r).expiresTs - Date.now()) / 86_400_000;
    ok("a session lasts two weeks (the 'log in again every 14 days' rule)", lifetimeDays > 13.99 && lifetimeDays < 14.01, lifetimeDays);
    admin.token = data(r).token;
    r = await post("/api/sd/login", { identifier: adminName, password: "wrong-password-1" });
    ok("wrong password -> 401 invalid_credentials", r.status === 401 && code(r) === "invalid_credentials", r);
    r = await post("/api/sd/login", { identifier: `nobody${sfx}`, password: "whatever12" });
    ok("unknown user gets the SAME error as a wrong password (no enumeration)", r.status === 401 && code(r) === "invalid_credentials");
    r = await post("/api/sd/password/change", { oldPassword: `Sandesh${adminName}`, newPassword: "short1" }, admin.token);
    ok("weak new password is rejected", r.status === 400 && code(r) === "weak_password", r);
    r = await post("/api/sd/password/change", { oldPassword: `Sandesh${adminName}`, newPassword: `Sandesh${adminName}` }, admin.token);
    ok("the default password can't be reused", r.status === 400 && code(r) === "weak_password", r);
    r = await post("/api/sd/password/change", { oldPassword: "not-the-old-one", newPassword: "Str0ngPass99" }, admin.token);
    ok("wrong old password is refused", r.status === 401, r);
    r = await post("/api/sd/password/change", { oldPassword: `Sandesh${adminName}`, newPassword: "Str0ngPass99" }, admin.token);
    ok("password change succeeds", r.status === 200, r);
    r = await post("/api/sd/login", { identifier: `root${sfx}@acme.com`, password: "Str0ngPass99" });
    ok("login by EMAIL with the new password works, no forced change now", r.status === 200 && data(r).mustChangePassword === false, r);
    admin.token = data(r).token;
    r = await post("/api/sd/login", { identifier: "+91 98860 12345", password: "Str0ngPass99" });
    ok("login by MOBILE (formatted differently) works", r.status === 200, r);
    r = await http("GET", "/api/sd/session", undefined, admin.token);
    ok("GET /session returns the user", r.status === 200 && data(r).user.username === adminName);
    r = await http("GET", "/api/sd/session", undefined, "garbage-token");
    ok("bad token -> 401", r.status === 401);

    console.log("=== WebSocket handshake rules (strict) ===");
    let c = await connectAs("intruder", "made-up-token");
    ok("strict: a made-up token is refused", c.first.type === "error" && /sign in to sandesh/i.test(c.first.text), c.first);
    c.close();
    c = await connectAs("someoneelse", admin.token);
    ok("strict: a valid token for a DIFFERENT username is refused", c.first.type === "error" && /different username/i.test(c.first.text), c.first);
    c.close();
    const A = await connectAs(adminName, admin.token);
    ok("valid session + matching username connects", A.first.type === "welcome");
    let m = await A.sd("me");
    ok("/sd me identifies the admin", m.ok && m.data.authenticated && m.data.permissions.isAdmin && m.data.mode === "strict", m);
    m = await A.sd("no.such.action");
    ok("unknown action -> unknown_action", !m.ok && m.error.code === "unknown_action", m);
    A.send("/sd me {oops");
    m = await A.waitFor(x => x.type === "sd" && x.ok === false && x.error.code === "bad_json", 2000, "bad_json");
    ok("malformed /sd JSON -> bad_json (connection survives)", !!m);

    console.log("=== Admin console gate (password + OTP) ===");
    m = await A.sd("admin.cfg.list", { kind: "branches" });
    ok("admin action before unlock -> admin_locked", !m.ok && m.error.code === "admin_locked", m);
    m = await A.sd("admin.unlock.start");
    ok("unlock/start sends an OTP", m.ok && /^\d{6}$/.test(m.data.devOtp ?? ""), m);
    const unlockOtp = m.data.devOtp;
    m = await A.sd("admin.unlock", { password: "wrongwrong1", otp: unlockOtp });
    ok("unlock with wrong password fails", !m.ok && m.error.code === "invalid_credentials", m);
    m = await A.sd("admin.unlock", { password: "Str0ngPass99", otp: "000000" === unlockOtp ? "111111" : "000000" });
    ok("unlock with wrong OTP fails", !m.ok && m.error.code === "otp_invalid", m);
    m = await A.sd("admin.unlock", { password: "Str0ngPass99", otp: unlockOtp });
    ok("unlock with password + OTP succeeds", m.ok && m.data.unlockedForSec > 0, m);
    m = await A.sd("admin.cfg.list", { kind: "categories" });
    ok("admin action after unlock works (seeded categories visible)", m.ok && m.data.items.length >= 9, m);

    console.log("=== Master data ===");
    m = await A.sd("admin.cfg.save", { kind: "branches", item: { name: "Bangalore HQ", country: "India", city: "Bangalore", pin: "560001" } });
    ok("save a branch", m.ok && m.data.item.name === "Bangalore HQ", m);
    m = await A.sd("admin.cfg.save", { kind: "branches", item: { name: "Bad", country: "India" } });
    ok("branch without city/pin is rejected", !m.ok && m.error.code === "invalid", m);
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "Engineering", description: "Builds things" } });
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "HR", description: "People" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Engineer", description: "" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Manager" } });
    m = await A.sd("admin.cfg.list", { kind: "departments" });
    ok("departments listed", m.ok && m.data.items.map(i => i.name).join() === "Engineering,HR", m);
    m = await A.sd("admin.cfg.save", { kind: "categories", item: { name: "Employee" } });
    ok('"Employee" is a reserved category name', !m.ok && m.error.code === "reserved_name", m);
    m = await A.sd("admin.cfg.delete", { kind: "categories", name: "Customer" });
    ok("categories can't be deleted, only deactivated", !m.ok && m.error.code === "not_allowed", m);
    m = await A.sd("admin.cfg.save", { kind: "affiliates", item: { name: "Acme Vendors Ltd", category: "Vendor", country: "India", city: "Pune", pin: "411001", branches: [{ name: "Pune-1", city: "Pune" }] } });
    ok("save an affiliate with a branch", m.ok && m.data.item.branches.length === 1, m);
    m = await A.sd("admin.cfg.save", { kind: "affiliates", item: { name: "Ghost Co", category: "NoSuchCategory" } });
    ok("affiliate with an unknown category is rejected", !m.ok && m.error.code === "invalid", m);

    console.log("=== Inviting users (admin) ===");
    const priya = `priya${sfx}`, ravi = `ravi${sfx}`, sam = `sam${sfx}`;
    m = await A.sd("users.invite", { name: "Priya S", username: priya, email: `${priya}@acme.com`, mobile: "+919000000001", isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Manager", isHost: true, hostScope: { employees: { any: true } } });
    ok("invite an employee who is a host (scope: any employee)", m.ok && m.data.user.isHost === true && m.data.user.host === adminName, m);
    m = await A.sd("users.invite", { name: "Sam W", username: sam, email: `${sam}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("invite an employee (host defaults to the inviting admin)", m.ok && m.data.user.host === adminName, m);
    m = await A.sd("users.invite", { name: "José 🚀 Ñandú", username: `jose${sfx}`, email: `jose${sfx}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("non-ASCII names (accents, emoji) survive the round trip", m.ok && m.data.user.name === "José 🚀 Ñandú", m);
    m = await A.sd("users.invite", { name: "Dup", email: `${sam}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("duplicate email -> email_taken", !m.ok && m.error.code === "email_taken", m);
    m = await A.sd("users.invite", { name: "Bad Branch", email: `bb${sfx}@acme.com`, isEmployee: true, branch: "Atlantis", department: "HR", designation: "Engineer" });
    ok("employee with a branch that doesn't exist is rejected", !m.ok && m.error.code === "invalid", m);
    m = await A.sd("users.invite", { name: "Host No Scope", email: `hns${sfx}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer", isHost: true });
    ok("a host without hostScope is rejected", !m.ok, m);
    m = await A.sd("users.invite", { name: "Mob", email: `mob${sfx}@acme.com`, mobile: "12", isEmployee: false, category: "Customer", country: "India", city: "Pune", pin: "1" });
    ok("invalid mobile is rejected", !m.ok && m.error.code === "invalid_mobile", m);
    m = await A.sd("users.invite", { name: "External NoLoc", email: `en${sfx}@x.com`, isEmployee: false, category: "Customer" });
    ok("non-employee needs country/city/pin", !m.ok && m.error.code === "invalid", m);
    m = await A.sd("users.invite", { name: "Both", email: `both${sfx}@x.com`, isEmployee: true, affiliate: "Acme Vendors Ltd", branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("employee + affiliate at once is rejected", !m.ok, m);

    console.log("=== Login for invited users (OTP-only) + brute-force lock ===");
    const P = await loginWithOtp(priya);
    ok("invited user logs in with an emailed OTP (no password needed)", P.login.status === 200 && !!P.token, P.login);
    ok("OTP login marks OTP as fresh (no otpDue)", data(P.login).otpDue === false);
    r = await post("/api/sd/login", { identifier: priya, otp: P.otp });
    ok("a used OTP can't be replayed", r.status === 401, r);
    const S = await loginWithOtp(sam);
    ok("second invited user logs in", !!S.token, S.login);
    // lockout uses a throwaway user
    m = await A.sd("users.invite", { name: "Locky", username: `locky${sfx}`, email: `locky${sfx}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    await post("/api/sd/otp/send", { identifier: `locky${sfx}` });
    let last;
    for (let i = 0; i < 5; i++) last = await post("/api/sd/login", { identifier: `locky${sfx}`, otp: "999999" });
    ok("wrong OTPs are rejected", last.status === 401, last);
    r = await post("/api/sd/login", { identifier: `locky${sfx}`, otp: "999999" });
    ok("after 5 failures the account is temporarily locked (429)", r.status === 429 && code(r) === "locked", r);

    console.log("=== Hosts, scope and self-registration approval ===");
    const PR = await connectAs(priya, P.token);
    ok("priya connects", PR.first.type === "welcome");
    m = await PR.sd("me");
    ok("priya is a host, not an admin", m.data.permissions.isHost && !m.data.permissions.isAdmin, m);
    m = await PR.sd("admin.cfg.list", { kind: "branches" });
    ok("a host can't use admin actions", !m.ok && m.error.code === "forbidden", m);
    m = await PR.sd("users.invite", { name: "Ravi K", username: ravi, email: `${ravi}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "Engineering", designation: "Engineer" });
    ok("a host invites an employee inside their scope", m.ok && m.data.user.host === priya, m);
    m = await PR.sd("users.invite", { name: "Vendor Guy", email: `vg${sfx}@x.com`, isEmployee: false, affiliate: "Acme Vendors Ltd", affiliateBranch: "Pune-1" });
    ok("a host can NOT invite someone outside their scope (affiliate member)", !m.ok && m.error.code === "forbidden", m);
    // self-registration
    r = await post("/api/sd/register", { name: "Erin E", username: `erin${sfx}`, email: `erin${sfx}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("employee self-registers -> pending", r.status === 200 && data(r).status === "pending" && data(r).awaitingApprovalFrom === 1, r);
    const erinReq = data(r).requestId;
    const reqPush = await PR.event("request_created");
    ok("the covering host (priya) gets a LIVE push about it", reqPush.data.type === "onboarding" && reqPush.data.subject === `erin${sfx}`, reqPush);
    m = await PR.sd("me");
    ok("/sd me reports how many requests are waiting on priya", m.data.pendingRequests === 1, m.data?.pendingRequests);
    r = await post("/api/sd/otp/send", { identifier: `erin${sfx}` });
    ok("a pending user can't get an OTP yet (403 pending_approval)", r.status === 403 && code(r) === "pending_approval", r);
    r = await post("/api/sd/register", { name: "Erin Again", email: `erin${sfx}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("registering the same email twice -> email_taken", r.status === 409 && code(r) === "email_taken", r);
    r = await post("/api/sd/register", { name: "Vera V", username: `vera${sfx}`, email: `vera${sfx}@acme-vendors.com`, isEmployee: false, affiliate: "Acme Vendors Ltd", affiliateBranch: "Pune-1" });
    ok("affiliate member self-registers -> goes to administrators (no host covers them)", r.status === 200 && data(r).awaitingApprovalFrom === 1, r);
    const veraReq = data(r).requestId;
    m = await PR.sd("req.list");
    ok("priya's pending list shows Erin", m.ok && m.data.requests.some(q => q.id === erinReq && q.status === "pending"), m);
    m = await PR.sd("req.respond", { id: veraReq, action: "accept" });
    ok("a host can't answer a request that isn't theirs", !m.ok && m.error.code === "forbidden", m);
    m = await PR.sd("notifications.summary");
    ok("a waiting approval is exactly one 'pending' notification (and nothing else notifies)", m.ok && m.data.counts.pending === 1 && m.data.total === 1 && m.data.counts.personal === 0 && m.data.counts.priority === 0 && m.data.counts.reminders === 0, m);
    m = await PR.sd("me");
    ok("/sd me carries the notification counts too (one call for the badges)", m.data.notifications.counts.pending === 1, m.data?.notifications);
    PR.clear();
    m = await PR.sd("req.respond", { id: erinReq, action: "accept" });
    ok("priya approves Erin's onboarding", m.ok && m.data.request.status === "accepted", m);
    const chg = await PR.event("notifications_changed");
    ok("answering the request pushes fresh counts (pending drops to 0 without polling)", chg.data.counts.pending === 0, chg);
    m = await PR.sd("req.respond", { id: erinReq, action: "accept" });
    ok("answering twice -> already_resolved", !m.ok && m.error.code === "already_resolved", m);
    const E = await loginWithOtp(`erin${sfx}`);
    ok("Erin can now sign in", !!E.token, E.login);
    m = await A.sd("admin.user.get", { username: `erin${sfx}` });
    ok("Erin's host is priya, active, linked as an associate", m.data.user.host === priya && m.data.user.status === "active" && m.data.associates.some(a => a.username === priya && a.relation === "host"), m);
    m = await A.sd("req.respond", { id: veraReq, action: "accept" });
    ok("the administrator approves Vera (affiliate member)", m.ok, m);
    const V = await loginWithOtp(`vera${sfx}`);
    ok("Vera can sign in after approval", !!V.token, V.login);

    console.log("=== Messaging rules (strict): only your host + accepted connections ===");
    const R = await loginWithOtp(ravi);
    const RV = await connectAs(ravi, R.token);
    const SM = await connectAs(sam, S.token);
    PR.clear(); RV.clear(); SM.clear();
    RV.send(`/msg ${priya} hello host`);
    let ack = await RV.waitFor(x => x.type === "dm_ack", 2000, "dm_ack");
    ok("a user can message their host", ack.status === "delivered", ack);
    const got = await PR.waitFor(x => x.type === "private" && x.text === "hello host", 2000, "host receives");
    ok("the host receives it live", !!got);
    PR.send(`/msg ${ravi} welcome aboard`);
    ack = await PR.waitFor(x => x.type === "dm_ack" && x.with === ravi, 2000, "dm_ack");
    ok("a host can message their user", !!ack);
    RV.send(`/msg ${sam} hey sam`);
    let e = await RV.waitFor(x => x.type === "error" && x.code === "not_associated", 2000, "not_associated");
    ok("messaging a non-associate is refused with code not_associated", !!e, e);
    ok("the refused message was NOT delivered", !SM.inbox.some(x => x.type === "private"));
    RV.send(`/msg ${sam} hey sam`);   // (still refused; sanity)
    // broadcast + directory privacy (strict)
    RV.send("hello everyone");
    e = await RV.waitFor(x => x.type === "error" && x.code === "not_allowed", 2000, "broadcast refused");
    ok("strict: a normal user can't broadcast to the global room", !!e, e);
    SM.clear();
    A.send(`announcement ${sfx}`);
    const ann = await SM.waitFor(x => x.type === "chat" && x.text === `announcement ${sfx}`, 2000, "announcement");
    ok("strict: an administrator can post announcements to everyone", !!ann);
    m = await RV.sd("users.search", { q: "sa" });
    ok("strict: a partial-name search returns nothing (no directory browsing)", m.ok && m.data.users.length === 0, m);
    m = await RV.sd("users.search", { q: sam });
    ok("strict: an exact username finds the person (public fields only)", m.ok && m.data.users.length === 1 && m.data.users[0].username === sam && !("email" in m.data.users[0]), m);
    m = await RV.sd("users.search", { q: `${sam}@acme.com` });
    ok("strict: an exact email finds the person", m.ok && m.data.users.length === 1, m);
    // invitation flow
    m = await RV.sd("assoc.invite", { to: sam });
    ok("ravi invites sam to connect", m.ok && m.data.request.status === "pending", m);
    const inv = await SM.event("request_created");
    ok("sam gets a live push for the invitation", inv.data.type === "associate" && inv.data.from === ravi, inv);
    m = await RV.sd("assoc.invite", { to: sam });
    ok("a duplicate invitation is refused", !m.ok && m.error.code === "duplicate", m);
    m = await RV.sd("assoc.invite", { to: ravi });
    ok("you can't invite yourself", !m.ok, m);
    m = await SM.sd("req.list");
    const invId = m.data.requests.find(q => q.type === "associate").id;
    m = await RV.sd("req.respond", { id: invId, action: "accept" });
    ok("the inviter can't accept their own invitation", !m.ok && m.error.code === "forbidden", m);
    m = await SM.sd("req.respond", { id: invId, action: "accept" });
    ok("sam accepts", m.ok && m.data.request.status === "accepted", m);
    const resolved = await RV.event("request_resolved");
    ok("ravi is told it was accepted (live)", resolved.data.status === "accepted", resolved);
    RV.clear(); SM.clear();
    RV.send(`/msg ${sam} now we can talk`);
    ack = await RV.waitFor(x => x.type === "dm_ack" && x.with === sam, 2000, "dm_ack");
    ok("after acceptance ravi can message sam", !!ack, ack);
    m = await RV.sd("assoc.list");
    ok("ravi's associates: host priya + peer sam, with presence", m.ok && m.data.associates.length === 2 && m.data.associates.find(a => a.user.username === sam).relation === "peer" && m.data.associates.find(a => a.user.username === sam).online === true, m);
    // ignore path
    m = await SM.sd("assoc.invite", { to: `vera${sfx}@acme-vendors.com` });
    ok("an invitation can address the person by email", m.ok && m.data.request.subject === `vera${sfx}`, m);
    const V2 = await connectAs(`vera${sfx}`, V.token);
    m = await V2.sd("req.list");
    const ig = m.data.requests.find(q => q.type === "associate");
    m = await V2.sd("req.respond", { id: ig.id, action: "ignore" });
    ok("an invitation can be ignored", m.ok && m.data.request.status === "ignored", m);
    SM.clear();
    SM.send(`/msg vera${sfx} hi`);
    e = await SM.waitFor(x => x.type === "error" && x.code === "not_associated", 2000, "refused");
    ok("an ignored invitation doesn't create a link", !!e);
    V2.close();

    console.log("=== Message cards & sections ===");
    RV.send(`/msg ${priya} !need approval today`);
    await sleep(500);
    m = await PR.sd("cards.list", { section: "all" });
    ok("priya has cards for what ravi sent", m.ok && m.data.cards.length >= 2, m);
    const urgent = m.data.cards.find(cd => cd.text.startsWith("!need"));
    ok('text starting with "!" lands in the priority section', urgent?.section === "priority", urgent);
    const plain = m.data.cards.find(cd => cd.text === "hello host");
    ok("a normal DM is a 'personal' card that points at the sender's chat", plain?.section === "personal" && plain.chat.with === ravi, plain);
    const pend = m.data.cards.find(cd => cd.kind === "request");
    ok("Erin's onboarding request is a 'pending' card", pend?.section === "pending", m.data.cards.map(x => x.kind));
    m = await PR.sd("sections.save", { name: "From Ravi", rules: [{ field: "from", op: "equals", value: ravi }] });
    ok("create a custom section with a rule", m.ok && m.data.section.name === "From Ravi", m);
    const secId = m.data.section.id;
    m = await PR.sd("cards.list", { section: secId });
    ok("cards from ravi now classify into the custom section (rules win)", m.ok && m.data.cards.length >= 2 && m.data.cards.every(x => x.from === ravi), m);
    m = await PR.sd("sections.save", { name: "Bad", rules: [{ field: "nope", op: "equals", value: "x" }] });
    ok("a rule with an invalid field is rejected", !m.ok && m.error.code === "invalid", m);
    m = await PR.sd("reminder.add", { text: "Review Q3 budget", dueTs: Date.now() + 3600_000 });
    ok("add a reminder -> 'reminders' card", m.ok && m.data.card.section === "reminders", m);
    m = await PR.sd("sections.delete", { id: secId });
    ok("delete a custom section", m.ok, m);
    m = await PR.sd("cards.dismiss", { id: plain.id });
    m = await PR.sd("cards.list", { section: "all" });
    ok("a dismissed card is gone", !m.data.cards.some(x => x.id === plain.id), m);

    console.log("=== Notifications: priority, pending, personal, reminders ===");
    m = await PR.sd("notifications.read", { all: true });
    ok("start from a clean slate: mark everything read", m.ok && m.data.total === 0, m);
    PR.clear();
    RV.send(`/msg ${priya} ping one`);
    let nt = await PR.waitFor(x => x.type === "sd_event" && x.event === "notification" && x.data.card.text === "ping one", 3000, "personal notification");
    ok("a DM is a live 'personal' notification, pushed with the new counts", nt.data.category === "personal" && nt.data.counts.counts.personal === 1, nt.data);
    RV.send(`/msg ${priya} !urgent thing`);
    nt = await PR.waitFor(x => x.type === "sd_event" && x.event === "notification" && x.data.card.text === "!urgent thing", 3000, "priority notification");
    ok('"!" makes it a live PRIORITY notification', nt.data.category === "priority" && nt.data.counts.counts.priority === 1, nt.data);
    m = await PR.sd("notifications.summary");
    ok("summary: personal 1, priority 1, pending 0, reminders 0", m.data.counts.personal === 1 && m.data.counts.priority === 1 && m.data.counts.pending === 0 && m.data.counts.reminders === 0 && m.data.total === 2, m.data);
    ok("summary breaks personal down by sender (per-chat badges)", m.data.personalBySender[ravi] === 1, m.data.personalBySender);
    m = await PR.sd("notifications.list", { category: "priority" });
    ok("list one category: the priority card, unread", m.ok && m.data.notifications.length === 1 && m.data.notifications[0].text === "!urgent thing" && m.data.notifications[0].read === false && m.data.notifications[0].category === "priority", m.data);
    m = await PR.sd("notifications.list", { category: "bogus" });
    ok("an unknown category is rejected", !m.ok && m.error.code === "invalid", m);
    // custom sections organise cards but must never silence a notification
    m = await PR.sd("sections.save", { name: "From Ravi", rules: [{ field: "from", op: "equals", value: ravi }] });
    const muteSec = m.data.section.id;
    PR.clear();
    RV.send(`/msg ${priya} ping two`);
    nt = await PR.waitFor(x => x.type === "sd_event" && x.event === "notification" && x.data.card.text === "ping two", 3000, "notification despite custom section");
    ok("a custom section files the card but the personal notification still fires", nt.data.card.section === muteSec && nt.data.category === "personal", nt.data);
    await PR.sd("sections.delete", { id: muteSec });
    // opening the DM (the chat UI sends /read dm <user>) clears that sender's notifications
    PR.clear();
    PR.send(`/read dm ${ravi}`);
    const chg2 = await PR.event("notifications_changed");
    ok("/read dm <user> clears that sender's notifications and pushes new counts", chg2.data.counts.personal === 0 && chg2.data.counts.priority === 0, chg2.data);
    // read by category and by id
    RV.send(`/msg ${priya} ping three`);
    RV.send(`/msg ${priya} !urgent again`);
    await sleep(500);
    m = await PR.sd("notifications.read", { category: "personal" });
    ok("mark one category read; the others stay", m.ok && m.data.counts.personal === 0 && m.data.counts.priority === 1, m.data);
    m = await PR.sd("notifications.list", { category: "priority" });
    m = await PR.sd("notifications.read", { ids: [m.data.notifications[0].id] });
    ok("mark by card id", m.ok && m.data.total === 0, m.data);
    m = await PR.sd("notifications.list", { category: "personal", unreadOnly: false });
    ok("read notifications stay listable with unreadOnly:false", m.data.notifications.length >= 3 && m.data.notifications.every(n => n.read === true), m.data.notifications.length);
    m = await PR.sd("notifications.read", {});
    ok("notifications.read with no target is rejected", !m.ok && m.error.code === "invalid", m);
    // reminders: silent until due, then a live notification
    PR.clear();
    m = await PR.sd("reminder.add", { text: "stand-up in a moment", dueTs: Date.now() + 1500 });
    ok("a future reminder is created but NOT counted yet", m.ok && m.data.card.due === false && m.data.card.category === "reminders", m.data);
    m = await PR.sd("notifications.summary");
    ok("...reminders count is 0 until it's due", m.data.counts.reminders === 0, m.data);
    nt = await PR.waitFor(x => x.type === "sd_event" && x.event === "notification" && x.data.card.text === "stand-up in a moment", 6000, "reminder fires");
    ok("when due, the scheduler fires it as a live 'reminders' notification", nt.data.category === "reminders" && nt.data.counts.counts.reminders === 1, nt.data);
    m = await PR.sd("reminder.add", { text: "right now" });
    ok("a reminder with no time notifies immediately", m.ok && m.data.card.due === true, m.data);
    await sleep(300);
    m = await PR.sd("notifications.summary");
    ok("reminders count is now 2", m.data.counts.reminders === 2, m.data);
    m = await PR.sd("reminder.add", { text: "next week", dueTs: Date.now() + 7 * 24 * 3600 * 1000 });
    m = await PR.sd("notifications.list", { category: "reminders", unreadOnly: true });
    ok("a far-future reminder isn't in the unread list", !m.data.notifications.some(n => n.text === "next week"), m.data);
    m = await PR.sd("notifications.list", { category: "reminders", unreadOnly: false });
    ok("...but is listed as upcoming (due:false) when asked for everything", m.data.notifications.some(n => n.text === "next week" && n.due === false), m.data);
    m = await PR.sd("notifications.read", { category: "reminders" });
    ok("mark reminders read", m.ok && m.data.counts.reminders === 0, m.data);
    m = await A.sd("cards.list", { section: "all" });
    ok("cards carry read/category/due; categories are null outside the four", m.data.cards.every(c => "read" in c && "category" in c && "due" in c), m.data.cards[0]);
    RV.clear(); PR.clear(); SM.clear();

    console.log("=== Groups (strict) ===");
    RV.clear(); PR.clear(); SM.clear();
    RV.send("/creategroup ravis_club");
    e = await RV.waitFor(x => x.type === "error" && x.code === "not_allowed", 2000, "not_allowed");
    ok("a non-host can't create a group", !!e, e);
    PR.send("/creategroup team_a");
    const gc = await PR.waitFor(x => x.type === "group_created", 2000, "group_created");
    ok("a host creates a group", gc.name === "team_a", gc);
    PR.send(`/addmember team_a ${ravi}`);
    const added = await RV.waitFor(x => x.type === "added_to_group" && x.name === "team_a", 2000, "added");
    ok("adding one of the host's OWN users is immediate (no approval)", !!added, added);
    PR.send(`/addmember team_a ${sam}`);
    const pending = await PR.waitFor(x => x.type === "group_invite_pending", 2000, "pending");
    ok("adding someone else's user needs approval -> group_invite_pending", pending.user === sam && pending.request.status === "pending", pending);
    ok("...and sam was NOT added yet", !SM.inbox.some(x => x.type === "added_to_group"));
    m = await A.sd("req.list");
    const gi = m.data.requests.find(q => q.type === "group_invite");
    ok("the invitee's host (admin) sees the group invite waiting", gi && gi.data.group === "team_a", m);
    m = await A.sd("req.respond", { id: gi.id, action: "accept" });
    ok("admin approves the group invite", m.ok, m);
    const added2 = await SM.waitFor(x => x.type === "added_to_group" && x.name === "team_a", 3000, "sam added");
    ok("sam is added and notified after approval", added2.members.includes(sam), added2);
    RV.clear(); SM.clear();
    PR.send("/groupmsg team_a hello team");
    const gm = await SM.waitFor(x => x.type === "group_message" && x.text === "hello team", 2000, "group msg");
    ok("group members receive group messages (members needn't be associates)", !!gm);
    await sleep(300);
    m = await SM.sd("cards.list", { section: "all" });
    ok("group message produced a 'general' card for sam", m.data.cards.some(x => x.kind === "group" && x.section === "general"), m);
    ok("...with no notification category (general never notifies)", m.data.cards.find(x => x.kind === "group").category === null);
    m = await SM.sd("notifications.list", { category: "all", unreadOnly: false });
    ok("group ('general') cards never appear in notifications", m.ok && !m.data.notifications.some(n => n.kind === "group"), m.data.notifications.map(n => n.kind));

    console.log("=== Options & lite forms (TStruct) ===");
    m = await A.sd("admin.tstruct.save", { name: "leave_request", caption: "Leave request", fields: [
        { name: "from_date", type: "date", caption: "From", required: true, min: "2020-01-01" },
        { name: "to_date", type: "date", caption: "To", required: true },
        { name: "kind", type: "list", caption: "Kind", options: ["Casual", "Sick"], required: true },
        { name: "doctor_note", type: "url", caption: "Doctor's note", required: true, condition: { field: "kind", op: "eq", value: "Sick" } },
        { name: "days", type: "wholenumber", caption: "Days", min: 1, max: 30 },
        { name: "contact", type: "mobile", caption: "Contact", withCountryCode: true },
    ] });
    ok("save a lite tstruct", m.ok && m.data.tstruct.fields.length === 6, m);
    m = await A.sd("admin.tstruct.save", { name: "bad_ref", fields: [{ name: "a", type: "text", condition: { field: "ghost", op: "eq", value: 1 } }] });
    ok("a condition referring to an unknown field is rejected", !m.ok && m.error.code === "invalid", m);
    const bigFields = Array.from({ length: 60 }, (_, i) => ({ name: `f${i}`, type: "text", caption: `A reasonably long caption for field number ${i} to pad the payload out`, required: false }));
    m = await A.sd("admin.tstruct.save", { name: "big_form", fields: bigFields });
    ok("a large (>5KB) form definition goes through /sd (not capped like chat text)", m.ok && m.data.tstruct.fields.length === 60, m.error ?? "");
    m = await A.sd("admin.tstruct.delete", { name: "big_form" });
    m = await A.sd("admin.option.save", { id: "leave", caption: "Apply for leave", type: "data_input", target: "leave_request", applicable: { categories: ["Employee"], departments: ["Engineering"] } });
    ok("save an option applicable to Engineering employees only", m.ok, m);
    m = await A.sd("admin.option.save", { id: "vendor_bills", caption: "Submit bill", type: "upload", applicable: { categories: ["Affiliate"], affiliates: ["Acme Vendors Ltd"] } });
    ok("save an option for one affiliate", m.ok, m);
    m = await A.sd("admin.option.save", { id: "everyone_help", caption: "Help", type: "axpert_page", target: "helppage" });
    ok("option with no 'applicable' = everyone", m.ok && m.data.option.applicable.categories === "all", m);
    m = await A.sd("admin.option.save", { id: "broken", caption: "x", type: "data_input", target: "no_such_form" });
    ok("data_input pointing at a missing form is rejected", !m.ok && m.error.code === "invalid", m);
    m = await RV.sd("options.list");
    const ravIds = m.data.options.map(o => o.id).sort().join();
    ok("ravi (Engineering employee) sees: leave + help", ravIds === "everyone_help,leave", ravIds);
    m = await SM.sd("options.list");
    ok("sam (HR employee) sees only: help", m.data.options.map(o => o.id).join() === "everyone_help", m.data.options);
    const V3 = await connectAs(`vera${sfx}`, (await loginWithOtp(`vera${sfx}`)).token).catch(() => null);
    if (V3 && V3.first.type === "welcome") {
        m = await V3.sd("options.list");
        ok("vera (that affiliate's member) sees: bills + help", m.data.options.map(o => o.id).sort().join() === "everyone_help,vendor_bills", m.data.options);
        V3.close();
    } else ok("vera connects for the affiliate option check", false, "could not reconnect (OTP cooldown?)");
    m = await SM.sd("tstruct.get", { name: "leave_request" });
    ok("sam can't fetch a form none of his options point at", !m.ok && m.error.code === "forbidden", m);
    m = await RV.sd("tstruct.get", { name: "leave_request" });
    ok("ravi can fetch the form", m.ok && m.data.tstruct.name === "leave_request", m);
    m = await RV.sd("tstruct.submit", { name: "leave_request", values: { from_date: "2026-13-40", kind: "Sick", days: 99, contact: "9886012345" } });
    ok("invalid values -> invalid_values with per-field messages", !m.ok && m.error.code === "invalid_values" &&
        m.error.details.fields.from_date && m.error.details.fields.to_date && m.error.details.fields.doctor_note && m.error.details.fields.days && m.error.details.fields.contact, m);
    m = await RV.sd("tstruct.submit", { name: "leave_request", values: { from_date: "2026-10-01", to_date: "2026-10-03", kind: "Casual", days: "3", doctor_note: "ignored because hidden", contact: "+919886012345" } });
    ok("valid submission is stored (conditional field hidden -> dropped)", m.ok && m.data.submission.values.days === 3 && !("doctor_note" in m.data.submission.values), m);
    m = await PR.sd("submissions.list");
    ok("the host sees their user's submission", m.ok && m.data.submissions.some(s => s.by === ravi), m);
    m = await A.sd("admin.tstruct.delete", { name: "leave_request" });
    ok("can't delete a form an option still uses", !m.ok && m.error.code === "in_use", m);
    m = await A.sd("admin.appconn.save", { name: "axpert_erp", url: "https://erp.example.com/api", authType: "basic", credentials: { username: "svc", password: "s3cret" } });
    ok("save an application connection", m.ok && m.data.connection.hasCredentials === true && !("credentials" in m.data.connection), m);
    m = await A.sd("admin.appconn.list");
    ok("credentials are never returned", m.ok && !JSON.stringify(m.data).includes("s3cret") && m.data.connections[0].hasCredentials === true, m);
    m = await A.sd("admin.appconn.save", { name: "bad_url", url: "ftp://nope" });
    ok("a non-http(s) connection URL is rejected", !m.ok, m);

    console.log("=== Admin console: users, affiliates, status, hosts ===");
    m = await A.sd("admin.users.list", { pageSize: 3, page: 1 });
    ok("user listing is paginated with totals + spec columns", m.ok && m.data.users.length === 3 && m.data.total >= 6 && "userType" in m.data.users[0] && "organisation" in m.data.users[0], m);
    m = await A.sd("admin.users.list", { q: "erin" });
    ok("user listing search", m.ok && m.data.total === 1 && m.data.users[0].userType === "employee", m);
    m = await A.sd("admin.users.list", { status: "pending" });
    ok("filter by status", m.ok && m.data.users.every(u => u.status === "pending"), m);
    m = await A.sd("admin.affiliates.list");
    const aff = m.data.affiliates.find(x => x.name === "Acme Vendors Ltd");
    ok("affiliate listing: name, category, branches, host users, users", aff && aff.category === "Vendor" && aff.users.some(u => u.username === `vera${sfx}`) && Array.isArray(aff.hosts), aff);
    m = await SM.sd("admin.user.status", { username: priya, active: false });
    ok("a plain user can't change anyone's status", !m.ok && m.error.code === "forbidden", m);
    m = await A.sd("admin.user.status", { username: adminName, active: false });
    ok("an admin can't deactivate themselves", !m.ok, m);
    m = await A.sd("admin.user.status", { username: priya, active: false });
    ok("deactivating a host reports the users left without a host (orphans)", m.ok && m.data.orphans.map(u => u.username).sort().join() === [ravi, `erin${sfx}`].sort().join(), m.data?.orphans);
    const dc = await PR.waitFor(x => x.type === "sd_event" && x.event === "disconnected", 3000, "disconnect notice");
    ok("a deactivated user's live connection is dropped", dc.reason === "account_deactivated");
    await sleep(300);
    r = await post("/api/sd/otp/send", { identifier: priya });
    ok("a deactivated user can't sign in (403 account_inactive)", r.status === 403 && code(r) === "account_inactive", r);
    m = await A.sd("admin.host.reassign", { from: priya, to: priya });
    ok("reassign to the same host is refused", !m.ok, m);
    m = await A.sd("admin.host.reassign", { from: priya, to: sam });
    ok("reassign to a non-host is refused", !m.ok && m.error.code === "invalid", m);
    m = await A.sd("admin.host.reassign", { from: priya, to: adminName });
    ok("reassign all of a deactivated host's users to an admin", m.ok && m.data.count === 2, m);
    m = await A.sd("admin.user.get", { username: ravi });
    ok("ravi is now hosted by the admin, with the old host link gone", m.data.user.host === adminName && !m.data.associates.some(a => a.username === priya) && m.data.associates.some(a => a.username === adminName && a.relation === "host"), m);
    RV.clear();
    RV.send(`/msg ${priya} still there?`);
    e = await RV.waitFor(x => x.type === "error" && x.code === "not_associated", 2000, "refused");
    ok("...so ravi can no longer message the old host", !!e);
    m = await A.sd("admin.user.status", { username: priya, active: true });
    ok("re-activate priya", m.ok && m.data.user.status === "active", m);
    m = await A.sd("admin.admins.add", { username: priya });
    ok("promote a second administrator", m.ok && m.data.admins.length === 2, m);
    m = await A.sd("admin.admins.remove", { username: priya });
    ok("demote them again", m.ok && m.data.admins.length === 1, m);
    m = await A.sd("admin.admins.remove", { username: adminName });
    ok("the last administrator can't be removed", !m.ok && m.error.code === "last_admin", m);
    m = await A.sd("admin.cfg.delete", { kind: "departments", name: "HR" });
    ok("a department still in use can't be deleted", !m.ok && m.error.code === "in_use", m);
    m = await A.sd("admin.org.get");
    ok("org summary counts", m.ok && m.data.org.name === "Acme Corp" && m.data.counts.users >= 6, m);

    console.log("=== Host transfer ===");
    const PR2 = await connectAs(priya, (await loginWithOtp(priya)).token).catch(() => null);
    if (PR2 && PR2.first.type === "welcome") {
        m = await PR2.sd("host.users");
        ok("priya (re-activated) now hosts nobody", m.ok && m.data.users.length === 0, m);
        m = await A.sd("admin.host.change", { user: `erin${sfx}`, host: priya });
        ok("admin sets Erin's host back to priya", m.ok && m.data.user.host === priya, m);
        m = await PR2.sd("host.transfer", { user: `erin${sfx}`, toHost: adminName });
        ok("a host proposes transferring a user to another host", m.ok && m.data.request.type === "host_transfer", m);
        m = await A.sd("req.list");
        const tr = m.data.requests.find(q => q.type === "host_transfer");
        m = await A.sd("req.respond", { id: tr.id, action: "accept" });
        ok("the receiving host accepts", m.ok, m);
        m = await A.sd("admin.user.get", { username: `erin${sfx}` });
        ok("Erin now belongs to the new host", m.data.user.host === adminName, m);
        m = await PR2.sd("host.transfer", { user: `erin${sfx}`, toHost: sam });
        ok("only the user's current host may transfer them", !m.ok && m.error.code === "forbidden", m);
        PR2.close();
    } else ok("priya reconnects", false, "reconnect failed");

    console.log("=== Handshake without an ARM session id ===");
    const noArm = new Client(`erin${sfx}`);
    await noArm.connect(E.token, false);
    const noArmFirst = await noArm.ready();
    ok("a Sandesh session alone is enough to connect (armSessionId optional)", noArmFirst.type === "welcome", noArmFirst);
    m = await noArm.sd("me");
    ok("...and the connection is fully signed in", m.data.authenticated === true && typeof m.data.sessionExpiresTs === "number" && m.data.sessionExpiresTs > Date.now(), m.data);
    noArm.close();

    console.log("=== Logout ===");
    r = await post("/api/sd/logout", {}, S.token);
    ok("logout succeeds", r.status === 200);
    r = await http("GET", "/api/sd/session", undefined, S.token);
    ok("a logged-out token is dead", r.status === 401);

    for (const cl of [A, PR, RV, SM]) cl.close();
    await sleep(300);
    console.log("\n=== SUMMARY ===");
    console.log(`${pass} passed, ${fail} failed`);
    if (failures.length) { console.log("Failures:"); failures.forEach(f => console.log("  - " + f)); }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error("TEST SCRIPT ERROR:", e); process.exit(2); });
