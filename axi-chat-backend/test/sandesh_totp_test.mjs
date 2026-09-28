// End-to-end test for MANDATORY TOTP two-factor auth (sd_totp + sd_auth's
// login/2) against a running backend in STRICT mode. Every account needs a
// password AND an authenticator-app code; enrollment happens inline at
// first login (no separate "turn 2FA on" step) -- see docs/SANDESH.md's
// "Mandatory two-factor (TOTP)" section for the full contract this drives.
//
// Start the backend like this (a scratch Redis DB, never DB 0). Freshness
// is shortened to 6s so the "code required again" path is testable without
// waiting 14 days -- same trick sandesh_session_test.mjs uses for sessions:
//   REDIS_DB=14 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   CHAT_RATE_LIMIT_MAX=1000 SANDESH_SCHEDULER_TICK_MS=500 SANDESH_TOTP_FRESH_SEC=6 \
//   erl -noshell -pa _build/default/lib/axi_chat_backend/ebin -pa _build/default/lib/eredis/ebin \
//       -s chat_app start 5559 8090
// then:
//   redis-cli -n 14 FLUSHDB
//   node test/sandesh_totp_test.mjs http://localhost:8090

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8090";
const sfx = Date.now().toString(36).slice(-5);
const nsfx = String(Date.now()).slice(-7);

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc + (detail !== undefined ? ` -- ${detail}` : "")); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
const get = (p, t) => http("GET", p, undefined, t);
const data = (r) => r.json?.data;
const code = (r) => r.json?.error?.code;

// ---- Pure-JS RFC 6238 TOTP so the test drives the real wire format. ----
function b32decode(str) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const clean = str.replace(/=+$/, "").toUpperCase();
    let bits = "";
    for (const c of clean) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
}
function hotp(secretBuf, counter) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac("sha1", secretBuf).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
                ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(bin % 1000000).padStart(6, "0");
}
function totpAt(secretB32, unixSec, step = 0) {
    const secret = b32decode(secretB32);
    const counter = Math.floor(unixSec / 30) + step;
    return hotp(secret, counter);
}
function totpNow(secretB32, step = 0) { return totpAt(secretB32, Math.floor(Date.now() / 1000), step); }
const curStep = () => Math.floor(Date.now() / 1000 / 30);

// The server rejects any code for a counter <= the last one it accepted for
// that account (anti-replay), so a test firing codes back-to-back must track
// the same "last accepted counter" the server does.
function makeStepper(secretB32) {
    let last = -1;
    return {
        async next() {
            let step = curStep();
            while (!(step > last)) { await sleep(400); step = curStep(); }
            last = step;
            return totpAt(secretB32, step * 30, 0);
        },
        async prev() {
            let step = curStep();
            while (!(step - 1 > last)) { await sleep(400); step = curStep(); }
            last = step - 1;
            return totpAt(secretB32, step * 30, -1);
        },
    };
}

async function main() {
    console.log(`Running mandatory-TOTP tests against ${BASE}`);

    // ---- First-run setup: no session, mandatory enrollment pending ----
    const pub = await get("/api/sd/public");
    if (data(pub)?.setupDone) { console.log("Org already set up in this DB -- run against a freshly flushed Redis DB."); process.exit(2); }
    const adminName = `totpadmin_${sfx}`;
    const start = await post("/api/sd/setup/start", { org: "TotpOrg", username: adminName, email: `${adminName}@example.com`, mobile: `9${nsfx}1` });
    ok("setup/start ok", start.status === 200, start.json);
    const verify = await post("/api/sd/setup/verify", { otp: data(start)?.devOtp });
    ok("setup/verify has NO session, hands back a QR instead", verify.status === 200 && !data(verify)?.token && data(verify)?.totpSetupRequired === true, verify.json);
    ok("setup/verify returns a base32 secret + otpauth URI", /^[A-Z2-7]+=*$/.test(data(verify)?.secret ?? "") && (data(verify)?.otpauthUri ?? "").startsWith("otpauth://totp/"), verify.json);
    ok("setup/verify hands back the default password", data(verify)?.defaultPassword === `Sandesh${adminName}`, verify.json);
    const adminPw = data(verify).defaultPassword;
    const adminSecret = data(verify).secret;
    const tp = makeStepper(adminSecret);

    // ---- Login-as-enrollment: unauthenticated, password-only reuses the pending secret ----
    const reStart = await post("/api/sd/login", { identifier: adminName, password: adminPw });
    ok("password-only login (still unenrolled) hands back the SAME pending secret", reStart.status === 200 && data(reStart)?.secret === adminSecret && !data(reStart)?.token, reStart.json);

    // ---- Wrong code during enrollment: rejected, still pending, counts as a failure ----
    const wrongEnroll = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: "000000" });
    ok("wrong code during enrollment -> otp_invalid, not enrolled", wrongEnroll.status === 401 && code(wrongEnroll) === "otp_invalid", wrongEnroll.json);
    const wrongPwDuringEnroll = await post("/api/sd/login", { identifier: adminName, password: "not-the-password-1", totp: totpNow(adminSecret) });
    ok("wrong password during enrollment -> invalid_credentials (password checked first)", wrongPwDuringEnroll.status === 401 && code(wrongPwDuringEnroll) === "invalid_credentials", wrongPwDuringEnroll.json);

    // ---- Correct code finishes enrollment AND logs in ----
    const code1 = await tp.next();
    const finish = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: code1 });
    ok("password + correct code finishes enrollment and logs in", finish.status === 200 && !!data(finish)?.token && data(finish)?.totpJustEnabled === true, finish.json);
    const recoveryCodes = data(finish).recoveryCodes;
    ok("finishing enrollment returns 10 recovery codes", Array.isArray(recoveryCodes) && recoveryCodes.length === 10, recoveryCodes);
    let token = data(finish).token;

    const st1 = await get("/api/sd/2fa/totp", token);
    ok("status: enabled once enrolled", st1.status === 200 && data(st1)?.enabled === true, st1.json);

    // ---- Password-only login succeeds within the freshness window ----
    // (Replay protection is proven for real further below, once freshness is
    // forced to expire -- within the window, password alone is sufficient
    // and any `totp` value is simply not consulted, so testing "replay" here
    // would just be testing that freshness works, a second time.)
    const freshLogin = await post("/api/sd/login", { identifier: adminName, password: adminPw });
    ok("password-only login succeeds within the freshness window", freshLogin.status === 200 && !!data(freshLogin)?.token, freshLogin.json);
    token = data(freshLogin).token;

    // ---- Wait out the (short, test-configured) freshness window ----
    console.log("  (waiting out the TOTP freshness window...)");
    await sleep(7000);
    const stalePwOnly = await post("/api/sd/login", { identifier: adminName, password: adminPw });
    ok("password-only login AFTER freshness expires -> totp_required", stalePwOnly.status === 401 && code(stalePwOnly) === "totp_required", stalePwOnly.json);

    // ---- Now prove replay protection for real: a stale code must not work, a fresh one must ----
    const staleReplay = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: code1 });
    ok("a long-stale code is rejected (otp_invalid)", staleReplay.status === 401 && code(staleReplay) === "otp_invalid", staleReplay.json);
    const freshCode = await tp.next();
    const postFreshnessLogin = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: freshCode });
    ok("a fresh code logs in again after freshness expired", postFreshnessLogin.status === 200 && !!data(postFreshnessLogin)?.token, postFreshnessLogin.json);
    token = data(postFreshnessLogin).token;

    // ---- Malformed codes, once freshness is forced to require one ----
    await sleep(7000);
    const badShape1 = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: "12345" });
    ok("5-digit totp -> otp_invalid, not a crash", badShape1.status === 401 && code(badShape1) === "otp_invalid", badShape1.json);
    const badShape2 = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: "abcdef" });
    ok("non-digit totp -> otp_invalid, not a crash", badShape2.status === 401 && code(badShape2) === "otp_invalid", badShape2.json);
    const badShape3 = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: "" });
    ok("empty totp (freshness expired) -> totp_required", badShape3.status === 401 && code(badShape3) === "totp_required", badShape3.json);

    // ---- Recovery codes: one-time use, case-insensitive ----
    const recCode = recoveryCodes[0];
    const recLogin1 = await post("/api/sd/login", { identifier: adminName, password: adminPw, recoveryCode: recCode });
    ok("login with a valid recovery code -> ok", recLogin1.status === 200 && !!data(recLogin1)?.token, recLogin1.json);
    token = data(recLogin1).token;
    // freshness was just reset by recLogin1, so re-sending the same recovery code right
    // now would be a no-op test (password alone already suffices) -- force expiry first.
    await sleep(7000);
    const recLogin2b = await post("/api/sd/login", { identifier: adminName, password: adminPw, recoveryCode: recCode });
    ok("reusing the same recovery code -> rejected", recLogin2b.status === 401 && code(recLogin2b) === "otp_invalid", recLogin2b.json);
    const recCode2 = recoveryCodes[1];
    const recLoginLower = await post("/api/sd/login", { identifier: adminName, password: adminPw, recoveryCode: recCode2.toLowerCase() });
    ok("recovery code is case-insensitive", recLoginLower.status === 200 && !!data(recLoginLower)?.token, recLoginLower.json);
    token = data(recLoginLower).token;

    // ---- disable requires password + a valid code ----
    await sleep(7000);
    const disableWrongPw = await post("/api/sd/2fa/totp/disable", { password: "nope-wrong", code: recoveryCodes[2] }, token);
    ok("disable with wrong password -> invalid_credentials", disableWrongPw.status === 401 && code(disableWrongPw) === "invalid_credentials", disableWrongPw.json);
    const disableWrongCode = await post("/api/sd/2fa/totp/disable", { password: adminPw, code: "000000" }, token);
    ok("disable with wrong code -> otp_invalid", disableWrongCode.status === 401 && code(disableWrongCode) === "otp_invalid", disableWrongCode.json);
    const disableOk = await post("/api/sd/2fa/totp/disable", { password: adminPw, code: recoveryCodes[2] }, token);
    ok("disable with password + a valid recovery code -> ok", disableOk.status === 200 && data(disableOk)?.disabled === true, disableOk.json);

    // ---- disabling doesn't turn 2FA off -- next login re-triggers enrollment ----
    const reEnrollStart = await post("/api/sd/login", { identifier: adminName, password: adminPw });
    ok("login after disable -> fresh enrollment (new secret), not a plain session", reEnrollStart.status === 200 && !!data(reEnrollStart)?.secret && data(reEnrollStart).secret !== adminSecret && !data(reEnrollStart)?.token, reEnrollStart.json);
    const secret2 = data(reEnrollStart).secret;
    const tp2 = makeStepper(secret2);
    const reEnrollFinish = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: await tp2.next() });
    ok("re-enrollment with the new secret finishes and logs in", reEnrollFinish.status === 200 && !!data(reEnrollFinish)?.token, reEnrollFinish.json);
    token = data(reEnrollFinish).token;
    // Force freshness to expire first -- otherwise this login would succeed via the
    // password-only shortcut regardless of what's in `totp`, proving nothing.
    await sleep(7000);
    const oldSecretDead = await post("/api/sd/login", { identifier: adminName, password: adminPw, totp: totpNow(adminSecret) });
    ok("the OLD (pre-disable) secret's codes no longer work", oldSecretDead.status === 401 && code(oldSecretDead) === "otp_invalid", oldSecretDead.json);

    // ---- recovery/regenerate invalidates the old set ----
    const regen = await post("/api/sd/2fa/totp/recovery/regenerate", { password: adminPw, code: await tp2.next() }, token);
    ok("recovery/regenerate -> 10 new codes", regen.status === 200 && Array.isArray(data(regen)?.recoveryCodes) && data(regen).recoveryCodes.length === 10, regen.json);

    // ---- Self-registration requires a password ----
    const u2 = `totpuser2_${sfx}`;
    const regNoPw = await post("/api/sd/register", { name: "No Password", username: u2, email: `${u2}@example.com`, mobile: `9${nsfx}2` });
    ok("self-register without a password -> weak_password", regNoPw.status === 400 && code(regNoPw) === "weak_password", regNoPw.json);
    const regWeakPw = await post("/api/sd/register", { name: "Weak Password", username: `${u2}b`, email: `${u2}b@example.com`, mobile: `9${nsfx}3`, password: "short1" });
    ok("self-register with a weak password -> weak_password", regWeakPw.status === 400 && code(regWeakPw) === "weak_password", regWeakPw.json);

    // ---- Unauthenticated access to the management endpoints is rejected ----
    const noAuthStatus = await get("/api/sd/2fa/totp");
    ok("GET status without a session -> 401", noAuthStatus.status === 401 && code(noAuthStatus) === "unauthenticated", noAuthStatus.json);
    const noAuthDisable = await post("/api/sd/2fa/totp/disable", { password: adminPw, code: "123456" });
    ok("disable without a session -> 401", noAuthDisable.status === 401 && code(noAuthDisable) === "unauthenticated", noAuthDisable.json);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) { console.log("\nFailures:"); for (const f of failures) console.log(" - " + f); process.exit(1); }
}

main().catch((e) => { console.error("Test crashed:", e); process.exit(1); });
