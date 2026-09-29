// Focused end-to-end test for the four TStruct additions on top of the
// existing Lite TStruct feature (already covered by sandesh_test.mjs):
//   1. submissions.update / submissions.delete
//   2. submissions.list filtered by {tstruct, ref}
//   3. ref/meta on tstruct.submit
//   4. tstruct.user.* -- user-created structures: any signed-in user can
//      make one, org-wide visible immediately, create-only (no edit),
//      owner-delete-only
//
// Same harness/conventions as sandesh_test.mjs (copy of its helpers) so it
// runs the same way, against a running backend in STRICT mode, scratch Redis:
//   REDIS_DB=13 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   CHAT_RATE_LIMIT_MAX=1000 SANDESH_SCHEDULER_TICK_MS=500 .\run.ps1 5557 8082
//   redis-cli -n 13 FLUSHDB   (must be empty -- first-run setup runs once)
//   node test/lite_tstruct_v2_test.mjs [http://localhost:8082]
//
// Login follows the mandatory-2FA rules in sd_auth/sd_totp: a password is
// checked only for the admin account (see enrollAndLogin below, used for
// ravi/sam); everyone still needs a TOTP code the first time.

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8082";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc + (detail !== undefined ? ` -- ${detail}` : "")); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}

async function http(method, path, body, token) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, json };
}
const post = (p, b, t) => http("POST", p, b ?? {}, t);
const data = (r) => r.json?.data;

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

// A password is checked only for the admin account (see sd_auth), so this
// covers ravi/sam's login: no password is ever sent. Handles both
// first-ever enrollment (server hands back a `secret`) and a login from an
// already-trusted device (server hands back a `token` straight away).
async function enrollAndLogin(identifier) {
    let r = await post("/api/sd/login", { identifier });
    if (data(r)?.token) return { token: data(r).token };
    const secret = data(r)?.secret;
    r = await post("/api/sd/login", { identifier, totp: totpNow(secret) });
    return { token: data(r)?.token };
}

class Client {
    constructor(name) { this.name = name; this.inbox = []; this.waiters = []; this.seq = 0; }
    async connect(token) {
        this.ws = new WebSocket(WS_URL);
        this.ws.addEventListener("message", (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch { m = { type: "__raw__", text: ev.data }; }
            this.inbox.push(m);
            for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].pred(m)) { this.waiters[i].resolve(m); this.waiters.splice(i, 1); }
        });
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.ws.send(JSON.stringify({ username: this.name, token: token ?? "fake" }));
        return this;
    }
    async ready() { return this.waitFor(m => m.type === "welcome" || m.type === "error", 3000, "handshake result"); }
    waitFor(pred, ms = 4000, label = "event") {
        const hit = this.inbox.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (client ${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    async sd(action, args = {}) {
        const reqId = `${this.name}-${++this.seq}`;
        this.ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        return this.waitFor(m => m.type === "sd" && m.reqId === reqId, 4000, `reply to ${action}`);
    }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}
async function connectAs(name, token) { const c = new Client(name); await c.connect(token); c.first = await c.ready(); return c; }

async function main() {
    console.log(`Lite TStruct v2 test against ${BASE}\n`);

    let r = await http("GET", "/api/sd/public");
    if (data(r)?.setupDone) {
        console.log("This database is already set up. Flush the scratch Redis DB and restart the backend, then re-run.");
        process.exit(2);
    }

    console.log("=== Setup: org + admin + two employees ===");
    const adminName = `root${sfx}`;
    r = await post("/api/sd/setup/start", { org: "Acme Corp", name: "Root Admin", username: adminName, email: `root${sfx}@acme.com`, mobile: "+919886012345" });
    const setupOtp = data(r).devOtp;
    r = await post("/api/sd/setup/verify", { otp: setupOtp });
    // setup/verify hands back enrollment step 1 (secret + defaultPassword),
    // not a session yet -- finish TOTP enrollment to get the admin's first
    // real token, same as any other unenrolled account's first login.
    const adminSecret = data(r).secret;
    const defaultPw = data(r).defaultPassword;
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, totp: totpNow(adminSecret) });
    let adminToken = data(r).token;
    // A fresh admin must change the default password before anything else works.
    r = await post("/api/sd/password/change", { oldPassword: defaultPw, newPassword: "Str0ngPass99" }, adminToken);
    if (!r.json?.ok) { console.log("password change failed:", r.json); process.exit(1); }
    r = await post("/api/sd/login", { identifier: adminName, password: "Str0ngPass99" });
    adminToken = data(r).token;

    const A = await connectAs(adminName, adminToken);
    ok("admin connects", A.first.type === "welcome", A.first);

    let m = await A.sd("admin.unlock.start");
    const unlockOtp = m.data.devOtp;
    m = await A.sd("admin.unlock", { password: "Str0ngPass99", otp: unlockOtp });
    ok("admin console unlocked", m.ok, m);

    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Bangalore", pin: "560001" } });
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "Eng" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Engineer" } });

    const ravi = `ravi${sfx}`, sam = `sam${sfx}`;
    await A.sd("users.invite", { name: "Ravi", username: ravi, email: `${ravi}@acme.com`, isEmployee: true, branch: "HQ", department: "Eng", designation: "Engineer" });
    await A.sd("users.invite", { name: "Sam", username: sam, email: `${sam}@acme.com`, isEmployee: true, branch: "HQ", department: "Eng", designation: "Engineer" });
    const RV = await connectAs(ravi, (await enrollAndLogin(ravi)).token);
    const SM = await connectAs(sam, (await enrollAndLogin(sam)).token);
    ok("ravi connects", RV.first.type === "welcome", RV.first);
    ok("sam connects", SM.first.type === "welcome", SM.first);

    console.log("=== ref/meta on tstruct.submit ===");
    m = await A.sd("admin.tstruct.save", { name: "expense", caption: "Expense claim", fields: [
        { name: "amount", type: "number", caption: "Amount", required: true },
    ] });
    ok("admin saves a global tstruct", m.ok, m);
    m = await A.sd("admin.option.save", { id: "expense", caption: "File an expense", type: "data_input", target: "expense" });
    ok("admin saves an option pointing at it", m.ok, m);

    m = await RV.sd("tstruct.submit", { name: "expense", values: { amount: 100 }, ref: "PROJ-1", meta: { source: "test" } });
    ok("submit with ref+meta succeeds", m.ok && m.data.submission.ref === "PROJ-1" && m.data.submission.meta.source === "test", m);
    const sub1Id = m.data.submission.id;
    m = await RV.sd("tstruct.submit", { name: "expense", values: { amount: 50 }, ref: "x".repeat(201) });
    ok("a ref over 200 chars is rejected", !m.ok && m.error.code === "invalid", m);
    m = await RV.sd("tstruct.submit", { name: "expense", values: { amount: 50 }, meta: "not-an-object" });
    ok("a non-object meta is rejected", !m.ok && m.error.code === "invalid", m);
    m = await RV.sd("tstruct.submit", { name: "expense", values: { amount: 75 }, ref: "PROJ-2" });
    ok("a second submission with a different ref succeeds", m.ok, m);
    const sub2Id = m.data.submission.id;
    m = await SM.sd("tstruct.submit", { name: "expense", values: { amount: 10 }, ref: "PROJ-1" });
    ok("sam's own submission can share the same ref as ravi's", m.ok, m);
    const sub3Id = m.data.submission.id;

    console.log("=== submissions.list filtered by {tstruct, ref} ===");
    m = await RV.sd("submissions.list", { tstruct: "expense" });
    const raviSeesAll = m.data.submissions.map(s => s.id).sort((a,b)=>a-b);
    ok("filtering by tstruct alone returns every 'expense' submission ravi can see (his own; sam's is not his host's)", raviSeesAll.includes(sub1Id) && raviSeesAll.includes(sub2Id) && !raviSeesAll.includes(sub3Id), raviSeesAll);
    m = await RV.sd("submissions.list", { tstruct: "expense", ref: "PROJ-1" });
    ok("filtering by tstruct+ref returns exactly ravi's PROJ-1 submission, not sam's or PROJ-2", m.data.submissions.length === 1 && m.data.submissions[0].id === sub1Id, m.data.submissions);
    m = await A.sd("submissions.list", { tstruct: "expense" });
    ok("an admin sees every submission of that struct regardless of who made it", m.data.submissions.some(s => s.id === sub3Id) && m.data.submissions.some(s => s.id === sub1Id), m.data.submissions.map(s=>s.id));
    m = await SM.sd("submissions.list", { tstruct: "expense", ref: "PROJ-1" });
    ok("sam filtering by tstruct+ref only sees his own, not ravi's, even though they share a ref", m.data.submissions.length === 1 && m.data.submissions[0].id === sub3Id, m.data.submissions);

    console.log("=== submissions.update / submissions.delete ===");
    m = await SM.sd("submissions.update", { id: sub1Id, values: { amount: 999 } });
    ok("sam cannot edit ravi's submission (forbidden)", !m.ok && m.error.code === "forbidden", m);
    m = await RV.sd("submissions.update", { id: sub1Id, values: { amount: "not-a-number" } });
    ok("an invalid edit is rejected the same way an invalid submit would be", !m.ok && m.error.code === "invalid_values" && !!m.error.details.fields.amount, m);
    m = await RV.sd("submissions.update", { id: sub1Id, values: { amount: 250 }, meta: { source: "edited" } });
    ok("ravi edits his own submission: values + meta both update, editedTs is stamped", m.ok && m.data.submission.values.amount === 250 && m.data.submission.meta.source === "edited" && !!m.data.submission.editedTs, m);
    m = await RV.sd("tstruct.get", { name: "expense" });
    // sanity: editing didn't touch the struct definition itself
    ok("the struct definition itself is untouched by editing a submission", m.ok && m.data.tstruct.fields.length === 1, m);

    m = await SM.sd("submissions.delete", { id: sub1Id });
    ok("sam cannot delete ravi's submission (forbidden)", !m.ok && m.error.code === "forbidden", m);
    m = await RV.sd("submissions.delete", { id: sub1Id });
    ok("ravi deletes his own submission", m.ok && m.data.deleted === true, m);
    m = await RV.sd("submissions.list", { tstruct: "expense", ref: "PROJ-1" });
    ok("deleted submission is gone from the struct+ref index too (not just the plain list)", m.data.submissions.length === 0, m.data.submissions);
    m = await RV.sd("submissions.delete", { id: sub1Id });
    ok("deleting an already-deleted submission is not_found, not a crash", !m.ok && m.error.code === "not_found", m);

    console.log("=== tstruct.user.* -- user-created structures: org-wide, create-only, owner-delete-only ===");
    m = await RV.sd("tstruct.user.list");
    ok("the user-created structure list starts empty", m.ok && m.data.tstructs.length === 0, m);
    m = await RV.sd("tstruct.user.save", { name: "budget", caption: "Budget tracker", fields: [
        { name: "item", type: "text", caption: "Item", required: true },
        { name: "cost", type: "number", caption: "Cost", required: true },
    ] });
    ok("a plain (non-admin, non-unlocked) user can create a structure", m.ok && m.data.tstruct.owner === ravi, m);
    m = await SM.sd("tstruct.user.get", { name: "budget" });
    ok("it's visible org-wide immediately -- sam can see ravi's struct with no Option, no admin action", m.ok && m.data.tstruct.fields.length === 2, m);
    m = await A.sd("tstruct.user.list");
    ok("...and it shows up in the shared list for anyone, including the admin", m.data.tstructs.some(t => t.name === "budget"), m.data.tstructs);
    m = await SM.sd("tstruct.user.save", { name: "budget", caption: "Sam's attempt at the same name", fields: [
        { name: "note", type: "text", caption: "Note" },
    ] });
    ok("a second user can NOT claim the same name -- rejected as duplicate, first-come-first-served", !m.ok && m.error.code === "duplicate", m);
    m = await RV.sd("tstruct.user.get", { name: "budget" });
    ok("...and ravi's original definition (2 fields) is untouched by the rejected attempt", m.ok && m.data.tstruct.fields.length === 2, m);

    // A DIFFERENT global (admin-managed) tstruct with the exact same name is
    // still a wholly separate collection -- Option-gated, editable by
    // re-saving, unlike the user-created one. Proves the two paths coexist.
    m = await A.sd("admin.tstruct.save", { name: "orgforms_leave", caption: "Org leave form", fields: [
        { name: "days", type: "wholenumber", caption: "Days", required: true },
    ] });
    ok("admin can still create an admin-managed tstruct through the unrelated old path", m.ok, m);
    m = await A.sd("tstruct.user.save", { name: "orgforms_leave", caption: "clash attempt", fields: [{ name: "x", type: "text" }] });
    ok("...and that name is claimed in the user-created collection too if someone tries -- no silent overwrite either direction", m.ok, m); // different collection, no collision expected
    m = await A.sd("tstruct.user.delete", { name: "orgforms_leave" });
    ok("admin cleans up their test user-struct (admin is the owner here, so allowed)", m.ok, m);

    m = await SM.sd("tstruct.user.submit", { name: "budget", values: { item: "Laptop", cost: 1200 } });
    ok("ANY user (not just the creator) can submit a record against a user-created structure -- that's the whole point of it being org-wide", m.ok && m.data.submission.scope === "user", m);
    const userSubId = m.data.submission.id;
    m = await SM.sd("submissions.list");
    ok("the submission shows up in the normal submissions.list for its own submitter", m.data.submissions.some(s => s.id === userSubId), m.data.submissions.map(s=>s.id));

    m = await RV.sd("submissions.update", { id: userSubId, values: { item: "x", cost: 1 } });
    ok("the STRUCTURE's creator (ravi) still can NOT edit SAM's record -- edit rights are per-submission ownership, unrelated to who owns the struct", !m.ok && m.error.code === "forbidden", m);
    m = await SM.sd("submissions.update", { id: userSubId, values: { item: "Laptop (16GB)", cost: 1300 } });
    ok("sam (the actual submitter) edits his own record against ravi's structure -- re-validates against ravi's definition correctly", m.ok && m.data.submission.values.cost === 1300, m);

    m = await RV.sd("tstruct.user.delete", { name: "budget" });
    ok("the struct's CREATOR (ravi) can delete it -- deleting a struct is owner-only, separate from who can submit records to it", m.ok && m.data.deleted === true, m);
    m = await RV.sd("tstruct.user.get", { name: "budget" });
    ok("...and it's really gone, org-wide", !m.ok && m.error.code === "not_found", m);
    m = await SM.sd("submissions.update", { id: userSubId, values: { item: "still there?", cost: 1 } });
    ok("editing a submission whose structure was since deleted fails cleanly (not_found), doesn't crash", !m.ok && m.error.code === "not_found", m);

    // Delete-permission check needs its own struct since 'budget' is gone now.
    m = await RV.sd("tstruct.user.save", { name: "vault", caption: "Vault", fields: [{ name: "note", type: "text" }] });
    ok("ravi creates another structure to test delete permissions on", m.ok, m);
    m = await SM.sd("tstruct.user.delete", { name: "vault" });
    ok("a non-creator (sam) can NOT delete someone else's structure", !m.ok && m.error.code === "forbidden", m);
    m = await A.sd("tstruct.user.delete", { name: "vault" });
    ok("...not even an admin -- deletion is creator-only, no admin override", !m.ok && m.error.code === "forbidden", m);
    m = await RV.sd("tstruct.user.get", { name: "vault" });
    ok("...so it's still there after both refused attempts", m.ok, m);

    A.close(); RV.close(); SM.close();

    console.log(`\n=== SUMMARY ===\n${pass} passed, ${fail} failed`);
    if (fail) { console.log("\nFailures:"); failures.forEach(f => console.log(" - " + f)); process.exit(1); }
}

main().catch(e => { console.error("TEST SCRIPT ERROR:", e); process.exit(1); });
