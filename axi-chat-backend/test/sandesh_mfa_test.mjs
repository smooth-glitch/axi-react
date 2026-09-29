// End-to-end test for the three login-rule changes on top of mandatory
// two-factor (see sandesh_totp_test.mjs for the original TOTP contract):
//   1. A password is required only for admin accounts.
//   2. Two-factor is demanded again per DEVICE, not just after a global
//      freshness window -- a device this account verified from recently is
//      trusted; any other device always asks, however recently the account
//      verified somewhere else.
//   3. A second factor can be an emailed OTP code instead of an
//      authenticator-app TOTP code, chosen once at enrollment.
//
// Start the backend on a scratch, EMPTY Redis DB, with a short device-trust
// window so "trust expires" is testable without waiting 14 days:
//   redis-cli -n 15 FLUSHDB
//   REDIS_DB=15 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   CHAT_RATE_LIMIT_MAX=1000 SANDESH_SCHEDULER_TICK_MS=500 SANDESH_DEVICE_TRUST_SEC=6 \
//   erl -noshell -pa _build/default/lib/axi_chat_backend/ebin -pa _build/default/lib/eredis/ebin \
//       -s chat_app start 5561 8092
// then:
//   node test/sandesh_mfa_test.mjs http://localhost:8092
//
// Node 22+, no dependencies beyond node:crypto.

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8092";
const sfx = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc + (detail !== undefined ? ` -- ${JSON.stringify(detail)}` : "")); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + JSON.stringify(detail) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function http(method, path, body, token, extraHeaders) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, json };
}
const post = (p, b, t, h) => http("POST", p, b ?? {}, t, h);
const get = (p, t, h) => http("GET", p, undefined, t, h);
const data = (r) => r.json?.data;
const code = (r) => r.json?.error?.code;

// ---- Pure-JS RFC 6238 TOTP, same as sandesh_totp_test.mjs -----------------
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
    const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(code % 1000000).padStart(6, "0");
}
function totpNow(secretB32) { return hotp(b32decode(secretB32), Math.floor(Date.now() / 1000 / 30)); }

async function main() {
    console.log(`Running device-trust / admin-only-password / email-2FA tests against ${BASE}`);

    // ---- Bootstrap: first admin (mandatory password + TOTP, unaffected) ----
    const adminName = `root${sfx}`;
    let r = await post("/api/sd/setup/start", { org: "Acme Corp", name: "Root Admin", username: adminName, email: `root${sfx}@acme.com`, mobile: "+919886012345" });
    let otp = data(r)?.devOtp;
    r = await post("/api/sd/setup/verify", { otp });
    const adminSecret = data(r).secret;
    const defaultPw = data(r).defaultPassword;
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, totp: totpNow(adminSecret) });
    const adminToken = data(r).token;
    let recoveryCodes = data(r).recoveryCodes;
    ok("admin bootstrap: enrolled + logged in", r.status === 200 && !!adminToken && recoveryCodes?.length === 10, r);
    let nextRecovery = 0;
    const useRecovery = () => recoveryCodes[nextRecovery++];

    console.log("=== Rule 1: password required only for admins ===");
    r = await post("/api/sd/login", { identifier: adminName });
    ok("admin login with NO password at all -> invalid_credentials, not a 2FA prompt", r.status === 401 && code(r) === "invalid_credentials", r);
    r = await post("/api/sd/login", { identifier: adminName, password: "definitely-wrong" });
    ok("admin login with WRONG password -> invalid_credentials", r.status === 401 && code(r) === "invalid_credentials", r);

    // A non-admin's login ignoring password entirely (right OR wrong) is
    // covered in sandesh_test.mjs, which already has an invited (non-admin)
    // user available via a host's WS `users.invite`. This file sticks to
    // plain HTTP (setup + login only) and exercises rules 2 and 3 -- device
    // trust and email 2FA -- against the admin account: those rules apply
    // identically regardless of role, and the admin is the one account this
    // file can fully drive without a WebSocket client.
    console.log("=== Rule 2 & 3: device trust and email 2FA (role-independent; driven here via the admin account) ===");

    // Each distinct device below is verified with its OWN recovery code
    // rather than a fresh totp:totpNow(...) call: the account's TOTP
    // `lastCounter` is shared across every device (correct anti-replay
    // behaviour for a single secret -- see sd_totp:verify_code_against),
    // so two real app-code verifications this close together would land in
    // the same 30-second step and the second would be spuriously rejected.
    // Recovery codes have no such shared-counter restriction (each is
    // independently one-time), so they're what this file uses to prove the
    // per-DEVICE trust logic itself without fighting TOTP's own timing.
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-A" });
    ok("a never-seen device (device-A) -> needs a code even right after enrollment", r.status === 401 && code(r) === "totp_required", r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-A", recoveryCode: useRecovery() });
    ok("device-A supplies a valid code -> logs in and is now itself trusted", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-A" });
    ok("device-A, now trusted -> subsequent login needs no code", r.status === 200 && !!data(r).token, r);

    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-B" });
    ok("a DIFFERENT device (device-B) -> demands a code even though device-A verified seconds ago", r.status === 401 && code(r) === "totp_required", r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-B", recoveryCode: useRecovery() });
    ok("device-B supplies a valid code -> logs in and is now itself trusted", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-B" });
    ok("device-B, now trusted -> subsequent login needs no code", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-A" });
    ok("device-A is STILL trusted independently of device-B's activity", r.status === 200 && !!data(r).token, r);

    // No deviceId at all -> fallback fingerprint from User-Agent. Two
    // distinct UAs are two distinct "devices"; the same UA is the same one.
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw }, null, { "User-Agent": "SandeshTestAgent/1.0" });
    ok("no deviceId, UA fallback 'Agent/1.0' -> first time, needs a code", r.status === 401 && code(r) === "totp_required", r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, recoveryCode: useRecovery() }, null, { "User-Agent": "SandeshTestAgent/1.0" });
    ok("...supplies the code -> logs in, trusts that UA fingerprint", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw }, null, { "User-Agent": "SandeshTestAgent/1.0" });
    ok("same UA again -> trusted, no code needed", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw }, null, { "User-Agent": "SandeshTestAgent/2.0-different" });
    ok("a DIFFERENT UA -> treated as a different device, needs a code", r.status === 401 && code(r) === "totp_required", r);

    console.log("=== Device trust expires (SANDESH_DEVICE_TRUST_SEC) ===");
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-expiry" });
    ok("device-expiry: first login needs a code", r.status === 401 && code(r) === "totp_required", r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-expiry", recoveryCode: useRecovery() });
    ok("device-expiry: code accepted, now trusted", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-expiry" });
    ok("device-expiry: still trusted immediately after", r.status === 200 && !!data(r).token, r);
    console.log("  (waiting out the device-trust window...)");
    await sleep(7000);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-expiry" });
    ok("device-expiry: trust window elapsed -> a code is required again", r.status === 401 && code(r) === "totp_required", r);

    console.log("=== Session totpDue reflects the SAME device's trust ===");
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-expiry", recoveryCode: useRecovery() });
    const tok1 = data(r).token;
    ok("device-expiry: re-verified", r.status === 200 && !!tok1, r);
    r = await get("/api/sd/session", tok1);
    ok("fresh session on a just-trusted device -> totpDue:false", r.status === 200 && data(r).totpDue === false, r);
    await sleep(7000);
    r = await get("/api/sd/session", tok1);
    ok("same session, device trust now expired -> totpDue:true (session itself still valid)", r.status === 200 && data(r).totpDue === true, r);

    console.log("=== Rule 3: email-based 2FA, chosen at enrollment ===");
    // A fresh admin-equivalent account is awkward to create without WS
    // `users.invite`; instead prove the email-2FA mechanics on a second
    // ADMIN promoted the only way reachable over plain HTTP setup: this repo
    // has no second-admin-via-HTTP path either, so exercise email 2FA by
    // DISABLING the admin's totp and re-enrolling it as email instead --
    // this account already has an active session/password, which is exactly
    // what re-enrollment needs.
    r = await post("/api/sd/2fa/totp/disable", { password: defaultPw, code: useRecovery() }, tok1);
    ok("disable current (totp) 2FA", r.status === 200 && data(r).disabled === true, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, mfaMethod: "email", deviceId: "device-email" });
    ok("re-enroll requesting mfaMethod:email -> sends a code, no secret/QR", r.status === 200 && data(r).totpSetupRequired === true && data(r).mfaMethod === "email" && data(r).secret === undefined, r);
    const enrollCode = data(r).devOtp;
    ok("dev mode echoes the emailed code", typeof enrollCode === "string" && enrollCode.length === 6, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, emailOtp: "000000", deviceId: "device-email" });
    ok("wrong enrollment code -> otp_invalid, not enrolled", r.status === 401 && code(r) === "otp_invalid", r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, emailOtp: enrollCode, deviceId: "device-email" });
    ok("correct enrollment code -> enrolled + logged in + recovery codes", r.status === 200 && !!data(r).token && data(r).totpJustEnabled === true && Array.isArray(data(r).recoveryCodes) && data(r).recoveryCodes.length === 10, r);
    const emailRecoveryCodes = data(r).recoveryCodes;
    let emailToken = data(r).token; // reassigned below: each later login supersedes the previous session

    r = await get("/api/sd/2fa/totp", emailToken);
    ok("GET status reports method:email", r.status === 200 && data(r).enabled === true && data(r).method === "email", r);

    console.log("=== Email 2FA at login from an untrusted device ===");
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-email-2" });
    ok("new device, email method -> login itself triggers sending a code (ok, not an error)", r.status === 200 && data(r).emailOtpRequired === true && data(r).mfaMethod === "email" && data(r).sent === true, r);
    const loginCode = data(r).devOtp;
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, emailOtp: "111111", deviceId: "device-email-2" });
    ok("wrong login code -> otp_invalid (counts as a failed attempt)", r.status === 401 && code(r) === "otp_invalid", r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, emailOtp: loginCode, deviceId: "device-email-2" });
    ok("correct login code -> logged in, device-email-2 now trusted", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-email-2" });
    ok("device-email-2, now trusted -> no code needed", r.status === 200 && !!data(r).token, r);
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-email-3" });
    ok("yet another new device -> asks again (email OTP is genuinely per-device, not per-account)", r.status === 200 && data(r).emailOtpRequired === true, r);

    console.log("=== A recovery code still works for an email-method account ===");
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, recoveryCode: emailRecoveryCodes[0], deviceId: "device-recovery" });
    ok("recovery code logs in from a brand-new device", r.status === 200 && !!data(r).token, r);
    emailToken = data(r).token;
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, recoveryCode: emailRecoveryCodes[0], deviceId: "device-recovery-2" });
    ok("reusing the same recovery code from another device -> rejected", r.status === 401 && code(r) === "otp_invalid", r);

    console.log("=== Managing email 2FA while signed in (disable / regenerate) ===");
    r = await post("/api/sd/2fa/totp/disable", { password: defaultPw, code: "999999" }, emailToken);
    ok("disable with a made-up code (no manage code requested) -> otp_invalid", r.status === 401 && code(r) === "otp_invalid", r);
    r = await post("/api/sd/2fa/email/request", {}, emailToken);
    ok("request a management code", r.status === 200 && r.json.data.sent === true, r);
    const manageCode = r.json.data.devOtp;
    r = await post("/api/sd/2fa/totp/recovery/regenerate", { password: defaultPw, code: manageCode }, emailToken);
    ok("regenerate recovery codes with a fresh emailed manage-code", r.status === 200 && Array.isArray(data(r).recoveryCodes) && data(r).recoveryCodes.length === 10, r);
    // That manage code is now spent (check_otp deletes it on success).
    r = await post("/api/sd/2fa/email/request", {}, emailToken);
    const manageCode2 = r.json.data.devOtp;
    r = await post("/api/sd/2fa/totp/disable", { password: defaultPw, code: manageCode2 }, emailToken);
    ok("disable email 2FA with a fresh manage-code -> succeeds", r.status === 200 && data(r).disabled === true, r);

    r = await post("/api/sd/2fa/email/request", {}, emailToken);
    ok("requesting a manage-code once 2FA is off -> rejected (no email method on file any more)", r.status === 400 && code(r) === "invalid", r);

    console.log("=== Re-enroll as TOTP again so the account is left in a normal state ===");
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, deviceId: "device-final" });
    ok("no 2FA enrolled -> back to enrollment (default method totp)", r.status === 200 && data(r).mfaMethod === "totp" && !!data(r).secret, r);
    const finalSecret = data(r).secret;
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, totp: totpNow(finalSecret), deviceId: "device-final" });
    ok("finishes re-enrollment", r.status === 200 && !!data(r).token, r);

    console.log("\n=== SUMMARY ===");
    console.log(`${pass} passed, ${fail} failed`);
    if (fail) {
        console.log("Failures:");
        for (const f of failures) console.log(`  - ${f}`);
        process.exitCode = 1;
    }
}

main().catch((e) => { console.error("Test run crashed:", e); process.exitCode = 1; });
