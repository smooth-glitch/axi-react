// Exhaustive end-to-end run of every SANDESH #command (people, approvals,
// notifications/cards, forms, admin) against a backend in SANDESH_MODE=strict,
// as several differently-privileged users. Proves a #command is exactly as
// permitted as the /sd action it stands for, and ends with a coverage check
// that FAILS if any Sandesh command in the server's catalog was never run.
//
// Start a backend on a scratch, EMPTY Redis DB (this test does the one-time
// first-run setup of the organisation):
//   REDIS_DB=14 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   CHAT_RATE_LIMIT_MAX=1000 .\run.ps1 5558 8083
//   redis-cli -n 14 FLUSHDB       # first, if that DB was used before
// then:
//   node test/hash_commands_strict_test.mjs [http://localhost:8083]
//
// Companion to hash_commands_full_test.mjs (chat commands, open mode).
// Login here follows the mandatory-2FA rules in sd_auth/sd_totp: a password
// is checked only for the admin account (see enrollAndLogin below, used for
// every non-admin); everyone still needs a TOTP code the first time (and
// again from an untrusted device -- not exercised here, see sandesh_mfa_test.mjs
// for that). Node 22+, no dependencies beyond node:crypto.

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8083";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const covered = new Set();

async function http(method, path, body, token) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
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
// covers every non-admin login in this file: no password is ever sent.
// Handles both first-ever enrollment (server hands back a `secret`) and a
// login from an already-trusted device (server hands back a `token`
// straight away, e.g. signing back in later in the same test run).
async function enrollAndLogin(identifier) {
    let r = await post("/api/sd/login", { identifier });
    if (data(r)?.token) return data(r).token;
    const secret = data(r)?.secret;
    r = await post("/api/sd/login", { identifier, totp: totpNow(secret) });
    return data(r)?.token;
}

class Client {
    constructor(name) { this.name = name; this.inbox = []; this.waiters = []; this.seq = 0; }
    async connect(token) {
        this.ws = new WebSocket(WS_URL);
        this.ws.addEventListener("message", (ev) => {
            const m = JSON.parse(ev.data);
            this.inbox.push(m);
            for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].pred(m)) { this.waiters[i].resolve(m); this.waiters.splice(i, 1); }
        });
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.ws.send(JSON.stringify({ username: this.name, token }));
        const first = await this.waitFor(m => m.type === "welcome" || m.type === "error", 3000, "handshake");
        if (first.type !== "welcome") throw new Error("handshake refused: " + first.text);
        return this;
    }
    waitFor(pred, ms = 3000, label = "event") {
        const hit = this.inbox.find(pred);
        return hit ? Promise.resolve(hit) : this.next(pred, ms, label);
    }
    next(pred, ms = 4000, label = "event") {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    ask(line, pred, ms = 4000) {
        const p = this.next(pred, ms, `reply to ${line}`);
        this.send(line);
        return p;
    }
    send(line) {
        const w = /^#([A-Za-z][\w-]*)/.exec(line);
        if (w) covered.add(w[1].toLowerCase());
        this.ws.send(line);
    }
    // a /sd call (setup / verification only -- never counted as #command coverage)
    sd(action, args = {}) {
        const reqId = `${this.name}-${++this.seq}`;
        return this.ask(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`, m => m.type === "sd" && m.reqId === reqId);
    }
    // a #command whose reply is an /sd envelope. `canon` = the command's canonical
    // name (the reqId is always "#<canonical name>", even when an alias was typed).
    hash(typed, rest = "", canon = typed) {
        return this.ask(`#${typed}${rest ? " " + rest : ""}`, m => m.type === "sd" && m.reqId === `#${canon}`);
    }
    complete(obj) { const input = obj.input; return this.ask("/cmdcomplete " + JSON.stringify(obj), m => m.type === "cmd_suggestions" && m.input === input); }
    async silent(pred, ms = 500) { const n = this.inbox.length; await sleep(ms); return !this.inbox.slice(n).some(pred); }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function main() {
    console.log(`Sandesh #commands (strict mode) against ${BASE}\n`);
    let r = await http("GET", "/api/sd/public");
    if (data(r)?.setupDone) { console.log("This DB is already set up: flush the scratch DB, restart the backend, re-run."); process.exit(2); }
    let m;

    console.log("=== Setup: org, admin ===");
    const adminName = `hroot${sfx}`, pw = "Str0ngPass99";
    r = await post("/api/sd/setup/start", { org: "Hash Co", name: "Root Admin", username: adminName, email: `${adminName}@hash.co`, mobile: "+919886012345" });
    r = await post("/api/sd/setup/verify", { otp: data(r).devOtp });
    // setup/verify hands back enrollment step 1 (secret + defaultPassword),
    // not a session yet -- finish TOTP enrollment to get the admin's first
    // real token, same as any other unenrolled account's first login.
    const adminSecret = data(r).secret;
    const defaultPw = data(r).defaultPassword;
    r = await post("/api/sd/login", { identifier: adminName, password: defaultPw, totp: totpNow(adminSecret) });
    const setupToken = data(r).token;

    console.log("=== A forced password change blocks Sandesh #commands (until it is done) ===");
    const A0 = await new Client(adminName).connect(setupToken);
    m = await A0.hash("me");
    ok("#me still works and reports mustChange", m.ok && m.data.password.mustChange === true, m);
    m = await A0.sd("cards.list");
    ok("#cards -> password_change_required", !m.ok && m.error.code === "password_change_required", m);
    m = await A0.hash("remind", "x");
    ok("#remind -> password_change_required", !m.ok && m.error.code === "password_change_required", m);
    A0.close();
    await post("/api/sd/password/change", { oldPassword: `Sandesh${adminName}`, newPassword: pw }, setupToken);
    const adminToken = data(await post("/api/sd/login", { identifier: adminName, password: pw })).token;
    const A = await new Client(adminName).connect(adminToken);

    console.log("=== Setup: master data, users, forms ===");
    m = await A.sd("admin.unlock.start");
    m = await A.sd("admin.unlock", { password: pw, otp: m.data.devOtp });
    ok("admin console unlocked over /sd (passwords are never #commands)", m.ok, m);
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "Ops" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    m = await A.sd("admin.cfg.save", { kind: "affiliates", item: { name: "Vendor Co", category: "Vendor", country: "India", city: "Pune", pin: "411001", branches: [{ name: "Pune-1", city: "Pune" }] } });
    ok("affiliate created", m.ok, m);
    const priya = `hpriya${sfx}`, sam = `hsam${sfx}`, ravi = `hravi${sfx}`, erin = `herin${sfx}`;
    const emp = (u, n) => ({ name: n, username: u, email: `${u}@hash.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst" });
    m = await A.sd("users.invite", { ...emp(priya, "Priya S"), isHost: true, hostScope: { employees: { any: true } } });
    ok("host invited", m.ok, m);
    ok("sam invited", (await A.sd("users.invite", emp(sam, "Sam W"))).ok);
    let P = await new Client(priya).connect(await enrollAndLogin(priya));
    m = await P.sd("users.invite", emp(ravi, "Ravi K"));
    ok("host invites ravi (his host is priya)", m.ok && m.data.user.host === priya, m);
    m = await P.sd("users.invite", emp(erin, "Erin E"));
    ok("host invites erin", m.ok, m);
    let S = await new Client(sam).connect(await enrollAndLogin(sam));
    const R = await new Client(ravi).connect(await enrollAndLogin(ravi));

    m = await A.sd("admin.tstruct.save", { name: "leave_request", caption: "Leave request", fields: [
        { name: "from_date", type: "date", caption: "From", required: true },
        { name: "days", type: "wholenumber", caption: "Days", min: 1, max: 30 }] });
    ok("form defined", m.ok, m);
    ok("option -> form", (await A.sd("admin.option.save", { id: "leave", caption: "Apply for leave", type: "data_input", target: "leave_request" })).ok);
    ok("option -> page", (await A.sd("admin.option.save", { id: "help", caption: "Help", type: "axpert_page", target: "helppage" })).ok);

    console.log("=== Catalog reflects who is asking ===");
    const cats = {};
    for (const [n, c] of [["admin", A], ["priya", P], ["sam", S]]) cats[n] = Object.fromEntries((await c.ask("/cmds", x => x.type === "cmd_catalog")).commands.map(x => [x.name, x]));
    ok("admin: Sandesh, host and admin commands all available", ["me", "notifications", "transfer", "admin-users", "admin-activate"].every(k => cats.admin[k].available), cats.admin["admin-users"]);
    ok("host: transfer available; admin-* requires admin",
        cats.priya.transfer.available && !cats.priya["admin-users"].available && cats.priya["admin-users"].requires === "admin");
    ok("host: admin-activate requires manage", cats.priya["admin-activate"].requires === "manage" || cats.priya["admin-activate"].requires === "admin", cats.priya["admin-activate"]);
    ok("employee: notifications available; admin-* requires admin",
        cats.sam.notifications.available && cats.sam["admin-org"].requires === "admin", cats.sam["admin-org"]);

    console.log("=== #me and #whoami ===");
    m = await A.hash("me");
    ok("#me: admin", m.ok && m.data.permissions.isAdmin && m.data.mode === "strict" && m.data.user.username === adminName, m);
    m = await P.hash("whoami", "", "me");
    ok("#whoami alias: host", m.ok && m.data.permissions.isHost && !m.data.permissions.isAdmin, m);
    m = await S.hash("me");
    ok("#me: employee", m.ok && !m.data.permissions.isHost && !m.data.permissions.isAdmin, m);

    console.log("=== #find / #search ===");
    m = await S.hash("find", adminName);
    ok("#find exact username", m.ok && m.data.users.map(u => u.username).includes(adminName), m);
    m = await S.hash("search", `${ravi}@hash.co`, "find");
    ok("#search alias, exact email", m.ok && m.data.users.map(u => u.username).includes(ravi), m);
    m = await S.hash("find", ravi.slice(0, 6));
    ok("strict mode: a partial name finds nobody (no directory browsing)", m.ok && m.data.users.length === 0, m);
    m = await S.hash("find", `nobody${sfx}`);
    ok("#find with no match -> empty, not an error", m.ok && m.data.users.length === 0, m);

    console.log("=== Policy before any association ===");
    m = await R.ask(`#dm ${sam} hi`, x => x.type === "error" || x.type === "dm_ack");
    ok("ravi #dm sam (not associated) -> not_associated", m.type === "error" && m.code === "not_associated", m);
    m = await R.hash("associates");
    ok("#associates: ravi has only his host", m.ok && m.data.associates.map(a => a.user.username).join() === priya, m);

    console.log("=== #connect -> #requests -> #accept ===");
    m = await S.hash("connect", ravi);
    ok("#connect sends an invitation", m.ok && m.data.request.type === "associate" && m.data.request.approvers.join() === ravi, m);
    const req1 = m.data.request.id;
    m = await S.hash("connect", ravi);
    ok("#connect again -> duplicate", !m.ok && m.error.code === "duplicate", m);
    m = await S.hash("connect", sam);
    ok("#connect to yourself -> refused", !m.ok, m);
    m = await S.hash("connect", `nobody${sfx}`);
    ok("#connect to nobody -> not_found", !m.ok && m.error.code === "not_found", m);
    m = await R.hash("requests");
    ok("#requests: ravi sees it pending", m.ok && m.data.requests.some(q => q.id === req1 && q.status === "pending"), m);
    m = await R.hash("approvals", "pending", "requests");
    ok("#approvals alias + status filter", m.ok && m.data.requests.some(q => q.id === req1), m);
    m = await S.hash("accept", String(req1));
    ok("the inviter can't answer their own invitation (forbidden)", !m.ok && m.error.code === "forbidden", m);
    m = await P.hash("accept", String(req1));
    ok("a third party can't answer it either", !m.ok && m.error.code === "forbidden", m);
    m = await R.hash("accept", String(req1));
    ok("#accept by the invitee", m.ok && m.data.request.status === "accepted", m);
    m = await R.hash("accept", String(req1));
    ok("#accept again -> already_resolved", !m.ok && m.error.code === "already_resolved", m);
    m = await S.hash("requests", "accepted");
    ok("#requests accepted lists it for the inviter too", m.ok && m.data.requests.some(q => q.id === req1), m);
    m = await S.ask("#requests bogus", x => x.type === "error");
    ok("#requests with a bad status is a usage error (never reaches Sandesh)", m.code === "usage", m);
    m = await R.hash("contacts", "", "associates");
    ok("#contacts alias: ravi now sees sam and priya", m.ok && [sam, priya].every(u => m.data.associates.map(a => a.user.username).includes(u)), m);
    const dm = await R.ask(`#dm ${sam} now we are connected`, x => x.type === "error" || x.type === "dm_ack");
    ok("...and #dm now delivers (policy follows the association)", dm.type === "dm_ack", dm);
    m = await S.hash("connect", ravi);
    ok("#connect when already connected -> already_associated", !m.ok && m.error.code === "already_associated", m);

    console.log("=== #disconnect ===");
    m = await S.hash("disconnect", ravi);
    ok("#disconnect removes the peer link", m.ok && m.data.removed === true, m);
    m = await R.ask(`#dm ${sam} still?`, x => x.type === "error" || x.type === "dm_ack");
    ok("...and DMs are refused again", m.type === "error" && m.code === "not_associated", m);
    m = await S.hash("disconnect", ravi);
    ok("#disconnect when not connected -> not_found", !m.ok && m.error.code === "not_found", m);
    m = await R.hash("disconnect", priya);
    ok("#disconnect from your HOST link -> not_allowed (only a host/admin changes that)", !m.ok && m.error.code === "not_allowed", m);

    console.log("=== #reject and #ignore ===");
    m = await S.hash("connect", ravi);
    const req2 = m.data.request.id;
    let sug = await R.complete({ input: "#accept " });
    ok("#accept <nothing> suggests the pending request ids, with who/what in the hint",
        sug.kind === "arg" && sug.arg.name === "requestId" && sug.items.some(i => i.value === String(req2) && /wants to connect/.test(i.hint)), sug);
    sug = await R.complete({ input: "#reject " });
    ok("#reject suggests the same pending requests", sug.items.some(i => i.value === String(req2)), sug.items);
    sug = await S.complete({ input: "#accept " });
    ok("...only requests waiting on YOU: the sender sees none", sug.items.length === 0, sug.items);
    m = await R.hash("reject", String(req2));
    ok("#reject", m.ok && m.data.request.status === "rejected", m);
    sug = await R.complete({ input: "#accept " });
    ok("a resolved request is no longer suggested", !sug.items.some(i => i.value === String(req2)), sug.items);
    m = await R.ask(`#dm ${sam} x`, x => x.type === "error" || x.type === "dm_ack");
    ok("a rejected invitation creates no link", m.type === "error" && m.code === "not_associated", m);
    m = await S.hash("connect", ravi);
    const req3 = m.data.request.id;
    m = await R.sd("req.respond", { id: Number(req3), action: "ignore" });
    ok("#ignore", m.ok && m.data.request.status === "ignored", m);
    m = await R.hash("requests", "all");
    ok("#requests all shows accepted, rejected and ignored", ["accepted", "rejected", "ignored"].every(s => m.data.requests.some(q => q.status === s)), m.data.requests?.map(q => q.status));
    m = await R.hash("accept", "99999999");
    ok("#accept of a nonexistent request -> not_found", !m.ok && m.error.code === "not_found", m);

    console.log("=== Hosts: #myusers and #transfer ===");
    m = await P.sd("host.users");
    ok("#myusers: priya hosts ravi and erin", m.ok && [ravi, erin].every(u => m.data.users.some(x => x.username === u)), m);
    ok("#myusers rows say who is online", m.data.users.find(x => x.username === ravi).online === true);
    m = await S.sd("host.users");
    ok("#myusers by a non-host -> forbidden", !m.ok && m.error.code === "forbidden", m);
    m = await S.hash("transfer", `${ravi} ${adminName}`);
    ok("#transfer by someone who isn't the user's host -> forbidden", !m.ok && m.error.code === "forbidden", m);
    m = await P.hash("transfer", `${ravi} ${sam}`);
    ok("#transfer to a non-host -> invalid", !m.ok && m.error.code === "invalid", m);
    m = await P.hash("transfer", `${ravi} ${priya}`);
    ok("#transfer to the current host -> invalid", !m.ok && m.error.code === "invalid", m);
    m = await P.hash("transfer", `${ravi} ${adminName}`);
    ok("#transfer proposes moving ravi to the admin", m.ok && m.data.request.type === "host_transfer" && m.data.request.approvers.join() === adminName, m);
    const trId = m.data.request.id;
    m = await A.hash("requests");
    ok("the receiving host sees it in #requests", m.ok && m.data.requests.some(q => q.id === trId), m);
    m = await A.hash("accept", String(trId));
    ok("#accept by the receiving host", m.ok && m.data.request.status === "accepted", m);
    m = await A.sd("host.users");
    ok("#myusers: ravi is now the admin's", m.ok && m.data.users.some(x => x.username === ravi), m);
    m = await P.sd("host.users");
    ok("#myusers: and no longer priya's", m.ok && !m.data.users.some(x => x.username === ravi) && m.data.users.some(x => x.username === erin), m);

    console.log("=== Cards: #cards, #dismiss, #remind ===");
    const dmA = await A.ask(`#dm ${sam} hello sam`, x => x.type === "error" || x.type === "dm_ack");
    ok("admin -> sam DM (sam's host is the admin)", dmA.type === "dm_ack", dmA);
    await A.ask(`#dm ${sam} !urgent thing`, x => x.type === "dm_ack");
    await sleep(400);
    m = await S.sd("cards.list");
    ok("#cards: sam has cards from the admin", m.ok && m.data.cards.length >= 2 && Array.isArray(m.data.sections), m);
    const urgent = m.data.cards.find(c => c.text?.startsWith("!urgent"));
    const plain = m.data.cards.find(c => c.text === "hello sam");
    ok('"!" text lands in the priority section', urgent?.section === "priority", urgent);
    m = await S.sd("cards.list", { section: "priority" });
    ok("#cards <section> filters", m.ok && m.data.cards.length >= 1 && m.data.cards.every(c => c.section === "priority"), m);
    m = await S.sd("cards.list", { section: "no_such_section" });
    ok("#cards for an unknown section -> empty, not an error", m.ok && m.data.cards.length === 0, m);
    m = await S.sd("cards.dismiss", { id: plain.id });
    ok("#dismiss <cardId>", m.ok && m.data.dismissed === true, m);
    m = await S.sd("cards.list");
    ok("...the card is gone, the other remains", !m.data.cards.some(c => c.id === plain.id) && m.data.cards.some(c => c.id === urgent.id), m);
    m = await S.hash("remind", `call "Priya" \\ about {"x":1} tomorrow`);
    ok("#remind creates a reminder card (quotes/braces/backslash survive)", m.ok && m.data.card.section === "reminders" && m.data.card.text === `call "Priya" \\ about {"x":1} tomorrow`, m);
    m = await S.hash("reminder", "second one", "remind");
    ok("#reminder alias", m.ok, m);
    m = await S.sd("cards.list", { section: "reminders" });
    ok("both reminders are in the reminders section", m.ok && m.data.cards.length === 2, m);
    m = await S.sd("cards.dismiss", { id: "all" });
    ok("#dismiss all", m.ok, m);
    m = await S.sd("cards.list");
    ok("...leaves nothing", m.ok && m.data.cards.length === 0, m);
    m = await S.sd("cards.dismiss", { id: "definitely_not_a_card_id" });
    ok("#dismiss of an unknown id is harmless", m.ok, m);

    console.log("=== Notifications: #notifications / #notifs / #markread ===");
    await A.ask(`#dm ${sam} fresh personal`, x => x.type === "dm_ack");
    await A.ask(`#dm ${sam} !fresh priority`, x => x.type === "dm_ack");
    await S.hash("remind", "fresh reminder");
    await sleep(400);
    m = await S.hash("notifications");
    ok("#notifications: unread, with counts", m.ok && m.data.notifications.length >= 3 && typeof m.data.counts === "object", m);
    for (const c of ["priority", "pending", "personal", "reminders", "all"]) {
        m = await S.hash("notifs", c, "notifications");
        ok(`#notifs ${c}`, m.ok && Array.isArray(m.data.notifications), m);
    }
    m = await S.hash("notifications", "PERSONAL");
    ok("category is case-insensitive (#notifications PERSONAL)", m.ok && Array.isArray(m.data.notifications), m);
    m = await S.sd("notifications.read", "personal" === "all" ? { all: true } : { category: "personal" });
    ok("#markread personal", m.ok, m);
    m = await S.hash("notifications", "personal");
    ok("...personal notifications are now read", m.ok && m.data.notifications.length === 0, m);
    m = await S.hash("notifications", "priority");
    ok("...priority ones are untouched", m.ok && m.data.notifications.length >= 1, m);
    for (const c of ["priority", "pending", "reminders", "all"]) {
        m = await S.sd("notifications.read", c === "all" ? { all: true } : { category: c });
        ok(`#markread ${c}`, m.ok, m);
    }
    m = await S.hash("notifications");
    ok("after #markread all nothing is unread", m.ok && m.data.notifications.length === 0, m);

    console.log("=== Forms: #forms / #options / #form / #submissions ===");
    m = await R.hash("forms");
    ok("#forms lists the options for this user", m.ok && ["leave", "help"].every(id => m.data.options.some(o => o.id === id)), m);
    m = await R.hash("options", "", "forms");
    ok("#options alias", m.ok && m.data.options.length >= 2, m);
    m = await R.hash("form", "leave_request");
    ok("#form returns the definition", m.ok && m.data.tstruct.name === "leave_request" && m.data.tstruct.fields.length === 2, m);
    m = await R.hash("form", "no_such_form");
    ok("#form for an unknown form -> error", !m.ok, m);
    m = await R.hash("submissions");
    ok("#submissions: none yet", m.ok && m.data.submissions.length === 0, m);
    m = await R.sd("tstruct.submit", { name: "leave_request", values: { from_date: "2026-10-01", days: 3 } });
    ok("(setup) ravi submits the form over /sd", m.ok, m);
    m = await R.hash("submissions");
    ok("#submissions now lists it", m.ok && m.data.submissions.some(s => s.by === ravi && s.values.days === 3), m);
    m = await A.hash("submissions");
    ok("...and #submissions for the admin also sees it (admins see everyone's)", m.ok, m);

    console.log("=== Lite T-Struct hash commands: #lookups / #tstruct / #tstruct-add (edit/delete are viewer buttons -> /sd) ===");
    m = await R.hash("lookups");
    ok("#lookups returns the org lists the option builder's dropdowns use",
        m.ok && ["branches", "departments", "designations", "categories", "affiliates"].every(k => Array.isArray(m.data[k])) && m.data.categories.length > 0, m);
    m = await R.hash("cfg-lookups", "", "lookups");
    ok("#cfg-lookups alias gives the same lists", m.ok && Array.isArray(m.data.branches), m);
    m = await R.sd("tstruct.user.save", { name: "hashpoll", caption: "Hash poll", fields: [{ name: "q", type: "text", caption: "Question", required: true }] });
    ok("(setup) ravi creates a user-made structure", m.ok, m);
    m = await R.hash("tstruct", "hashpoll");
    ok("#tstruct returns the definition, its scope and (none yet) your records",
        m.ok && m.data.tstruct.name === "hashpoll" && m.data.scope === "user" && Array.isArray(m.data.submissions) && m.data.submissions.length === 0, m);
    m = await R.hash("tstruct-add", "hashpoll", "tstruct-add");
    ok("#tstruct-add opens the definition to add a record", m.ok && m.data.tstruct.name === "hashpoll", m);

    console.log("=== #tstruct suggestions: listing, paging, multi-word captions ===");
    for (let i = 1; i <= 12; i++) {
        m = await R.sd("tstruct.user.save", { name: `tsx_${i}_${sfx}`, caption: `Test Form ${i} ${sfx}`, fields: [{ name: "q", type: "text", caption: "Q", required: false }] });
        if (!m.ok) { ok(`(setup) structure ${i}`, false, m); break; }
    }
    let c = await R.complete({ input: "#tstruct ", page: 1, pageSize: 5 });
    ok("#tstruct <nothing> lists structures, 5 per page, with paging info",
        c.kind === "arg" && c.items.length === 5 && c.total >= 13 && c.hasMore === true && c.page === 1 && c.totalPages === Math.ceil(c.total / 5), c);
    const p1 = c.items.map(i => i.value);
    c = await R.complete({ input: "#tstruct ", page: 2, pageSize: 5 });
    ok("page 2 is a different set", c.page === 2 && c.items.length === 5 && c.items.every(i => !p1.includes(i.value)), c.items);
    c = await R.complete({ input: "#tstruct ", page: 99, pageSize: 5 });
    ok("a page past the end is clamped to the last page", c.page === c.totalPages && c.hasMore === false && c.items.length >= 1, c);
    c = await R.complete({ input: "#tstruct Test Form 1" });
    ok("typing a multi-word caption filters the list (the whole phrase is the token)",
        c.kind === "arg" && c.token === "Test Form 1" && c.items.length >= 1 && c.items.every(i => i.value.startsWith("Test Form 1")), c);
    c = await R.complete({ input: "#tstruct hash", page: 1 });
    ok("...and matching by technical name works too", c.items.some(i => i.hint === "hashpoll"), c.items);
    m = await R.hash("tstruct", `Test Form 3 ${sfx}`);
    ok("#tstruct opens a structure by its multi-word caption", m.ok && m.data.tstruct.name === `tsx_3_${sfx}`, m);
    m = await R.hash("tstruct", `test form 3 ${sfx}`);
    ok("...in any letter case", m.ok && m.data.tstruct.name === `tsx_3_${sfx}`, m);
    c = await R.complete({ input: "#tstruct-edit Test Form 3 " });
    ok("#tstruct-edit no longer exists in the # layer", c.kind === "none", c);
    c = await S.complete({ input: "#tstruct ", pageSize: 25 });
    ok("another user sees user-made structures too", c.kind === "arg" && c.total >= 13, c.total);
    m = await R.hash("tstruct", "no_such_struct");
    ok("#tstruct for an unknown structure -> not_found", !m.ok && m.error.code === "not_found", m);
    m = await R.sd("tstruct.user.submit", { name: "hashpoll", values: { q: "lunch?" } });
    const pollId = m.data?.submission?.id;
    ok("(setup) ravi submits a record", m.ok && Number.isInteger(pollId), m);
    m = await R.hash("tstruct", "hashpoll");
    ok("#tstruct now lists ravi's own record", m.ok && m.data.submissions.some(x => x.id === pollId), m);
    m = await A.hash("tstruct", "hashpoll");
    ok("...but only YOUR records: the admin sees the definition, not ravi's record", m.ok && m.data.tstruct.name === "hashpoll" && !m.data.submissions.some(x => x.id === pollId), m);
    m = await R.sd("tstruct.user.open", { name: "hashpoll", editRecordId: pollId });
    ok("viewer Edit button (/sd tstruct.user.open + editRecordId) passes the record id through", m.ok && m.data.editRecordId === pollId && m.data.tstruct.name === "hashpoll", m);
    m = await R.sd("submissions.delete", { id: pollId });
    ok("viewer Delete button (/sd submissions.delete) by the author deletes the record", m.ok && m.data.deleted === true, m);
    m = await R.hash("tstruct", "hashpoll");
    ok("...and it is gone from #tstruct", m.ok && m.data.submissions.length === 0, m);
    m = await R.sd("tstruct.user.submit", { name: "hashpoll", values: { q: "again" } });
    const pollId2 = m.data?.submission?.id;
    m = await A.sd("submissions.delete", { id: pollId2 });
    ok("deleting someone else's record is refused (author only)", !m.ok && m.error.code === "forbidden", m);
    m = await R.sd("tstruct.user.delete", { name: "hashpoll" });
    ok("(cleanup) ravi deletes the structure", m.ok, m);

    console.log("=== Admin: read commands ===");
    m = await A.hash("admin-org");
    ok("#admin-org", m.ok && m.data.org.name === "Hash Co" && m.data.counts.users >= 5, m);
    m = await A.hash("admin-users");
    ok("#admin-users lists everyone with type/online/active", m.ok && m.data.total >= 5 && m.data.users.every(u => "userType" in u && "online" in u && "active" in u), m);
    m = await A.hash("admin-users", ravi.slice(0, 7));
    ok("#admin-users <q> filters (admins CAN search partials)", m.ok && m.data.users.length === 1 && m.data.users[0].username === ravi, m);
    m = await A.hash("admin-users", `zzz_${sfx}`);
    ok("#admin-users with no match -> empty", m.ok && m.data.total === 0, m);
    m = await A.hash("admin-admins");
    ok("#admin-admins", m.ok && m.data.admins.length === 1 && m.data.admins[0].username === adminName, m);
    m = await A.hash("admin-affiliates");
    ok("#admin-affiliates", m.ok && m.data.affiliates.some(a => a.name === "Vendor Co"), m);

    console.log("=== Admin: #admin-deactivate / #admin-activate ===");
    m = await A.hash("admin-deactivate", adminName);
    ok("can't deactivate yourself", !m.ok && m.error.code === "invalid", m);
    m = await A.hash("admin-deactivate", `nobody${sfx}`);
    ok("deactivate a nonexistent user -> not_found", !m.ok && m.error.code === "not_found", m);
    const gone = R.next(x => x.type === "sd_event" && x.event === "disconnected", 4000, "disconnect notice");
    m = await A.hash("admin-deactivate", ravi);
    ok("#admin-deactivate ravi", m.ok && m.data.user.status === "inactive", m);
    ok("...ravi's live connection is ended with a 'disconnected' event", (await gone).reason === "account_deactivated");
    m = await A.hash("admin-users", ravi);
    ok("...and the directory shows him inactive", m.ok && m.data.users[0].active === false, m);
    m = await S.hash("find", ravi);
    ok("...and he no longer shows up in #find", m.ok && m.data.users.length === 0, m);
    m = await A.hash("admin-activate", ravi);
    ok("#admin-activate ravi", m.ok && m.data.user.status === "active", m);
    m = await S.hash("find", ravi);
    ok("...and he is findable again", m.ok && m.data.users.length === 1, m);
    // deactivating a host hands the admin the orphaned users
    const gone2 = P.next(x => x.type === "sd_event" && x.event === "disconnected", 4000, "disconnect notice");
    m = await A.hash("admin-deactivate", priya);
    ok("#admin-deactivate a host returns their orphaned users", m.ok && m.data.orphans.some(o => o.username === erin), m);
    await gone2;
    m = await A.hash("admin-activate", priya);
    ok("#admin-activate the host again", m.ok, m);
    P.close();   // her old connection was ended by the deactivation; sign in again
    P = await new Client(priya).connect(await enrollAndLogin(priya));
    ok("...and she can sign back in", true);

    console.log("=== Permissions: the same commands as non-admins ===");
    for (const [who, c] of [["employee", S], ["host", P]]) {
        for (const [cmd, arg] of [["admin-org", ""], ["admin-users", ""], ["admin-admins", ""], ["admin-affiliates", ""]]) {
            m = await c.hash(cmd, arg);
            ok(`${who}: #${cmd} -> forbidden`, !m.ok && m.error.code === "forbidden", m);
        }
    }
    m = await S.hash("admin-deactivate", adminName);
    ok("employee: #admin-deactivate -> forbidden (admin untouched)", !m.ok && m.error.code === "forbidden", m);
    m = await S.hash("admin-activate", adminName);
    ok("employee: #admin-activate -> forbidden", !m.ok && m.error.code === "forbidden", m);
    m = await P.hash("admin-deactivate", erin);
    ok("host: #admin-deactivate -> forbidden (can't manage users)", !m.ok && m.error.code === "forbidden", m);

    console.log("=== Admin console lock: a fresh admin session is locked until unlocked ===");
    A.close();
    await sleep(300);
    const adminToken2 = data(await post("/api/sd/login", { identifier: adminName, password: pw })).token;
    const A2 = await new Client(adminName).connect(adminToken2);
    for (const cmd of ["admin-org", "admin-users", "admin-admins", "admin-affiliates"]) {
        m = await A2.hash(cmd);
        ok(`locked: #${cmd} -> admin_locked`, !m.ok && m.error.code === "admin_locked", m);
    }
    m = await A2.hash("admin-deactivate", sam);
    ok("locked: #admin-deactivate -> admin_locked (and sam is untouched)", !m.ok && m.error.code === "admin_locked", m);
    const cat2 = Object.fromEntries((await A2.ask("/cmds", x => x.type === "cmd_catalog")).commands.map(x => [x.name, x]));
    ok("catalog still says admin commands are available (lock is a runtime state, not a role)", cat2["admin-org"].available === true);
    m = await A2.sd("cards.list");
    ok("locked console doesn't affect ordinary commands (#cards works)", m.ok, m);
    m = await A2.sd("admin.unlock.start");
    m = await A2.sd("admin.unlock", { password: pw, otp: m.data.devOtp });
    ok("unlock over /sd", m.ok, m);
    m = await A2.hash("admin-org");
    ok("unlocked: #admin-org works", m.ok, m);
    m = await A2.hash("admin-deactivate", sam);
    ok("unlocked: #admin-deactivate works", m.ok, m);
    m = await A2.hash("admin-activate", sam);
    ok("unlocked: #admin-activate works", m.ok, m);
    S.close();   // the deactivation ended sam's connection; sign in again
    S = await new Client(sam).connect(await enrollAndLogin(sam));

    console.log("=== Chat rules under #commands (strict) ===");
    const bc = await P.ask("##hello everyone", x => x.type === "error" || x.type === "own_message_id");
    ok("## broadcast refused for a non-admin", bc.type === "error" && bc.code === "not_allowed", bc);
    const bcA = A2.next(x => x.type === "own_message_id", 3000);
    A2.send("##hello everyone");
    ok("## broadcast allowed for an admin", !!(await bcA));
    const cg = await S.ask("#creategroup samgroup", x => x.type === "error" || x.type === "group_created");
    ok("#creategroup is host-only", cg.type === "error" && cg.code === "not_allowed", cg);
    const cg2 = await P.ask(`#creategroup pg${sfx}`, x => x.type === "error" || x.type === "group_created");
    ok("#creategroup works for a host", cg2.type === "group_created", cg2);

    console.log("=== Coverage: every Sandesh command in the catalog was executed ===");
    const catAll = (await A2.ask("/cmds", x => x.type === "cmd_catalog")).commands;
    const sandesh = catAll.filter(c => ["people", "inbox", "forms", "admin"].includes(c.category));
    const missing = sandesh.filter(c => ![c.name, ...c.aliases].some(n => covered.has(n)));
    ok(`all ${sandesh.length} Sandesh commands executed at least once`, missing.length === 0, missing.map(c => c.name));
    const unusedAliases = sandesh.flatMap(c => c.aliases.filter(a => !covered.has(a)).map(a => `${c.name}/${a}`));
    console.log(`  info: aliases not exercised here: ${unusedAliases.join(", ") || "none"}`);

    for (const c of [A2, P, S, R]) c.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
    process.exit(0);
}

main().catch(e => { console.error("Test run crashed:", e); process.exit(2); });
