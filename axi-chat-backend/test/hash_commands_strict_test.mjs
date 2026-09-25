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
// Node 22+, no dependencies.

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

async function otpLogin(identifier) {
    const s = await post("/api/sd/otp/send", { identifier });
    const r = await post("/api/sd/login", { identifier, otp: data(s)?.devOtp });
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
    const setupToken = data(r).token;

    console.log("=== A forced password change blocks Sandesh #commands (until it is done) ===");
    const A0 = await new Client(adminName).connect(setupToken);
    m = await A0.hash("me");
    ok("#me still works and reports mustChange", m.ok && m.data.password.mustChange === true, m);
    m = await A0.hash("cards");
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
    let P = await new Client(priya).connect(await otpLogin(priya));
    m = await P.sd("users.invite", emp(ravi, "Ravi K"));
    ok("host invites ravi (his host is priya)", m.ok && m.data.user.host === priya, m);
    m = await P.sd("users.invite", emp(erin, "Erin E"));
    ok("host invites erin", m.ok, m);
    let S = await new Client(sam).connect(await otpLogin(sam));
    const R = await new Client(ravi).connect(await otpLogin(ravi));

    m = await A.sd("admin.tstruct.save", { name: "leave_request", caption: "Leave request", fields: [
        { name: "from_date", type: "date", caption: "From", required: true },
        { name: "days", type: "wholenumber", caption: "Days", min: 1, max: 30 }] });
    ok("form defined", m.ok, m);
    ok("option -> form", (await A.sd("admin.option.save", { id: "leave", caption: "Apply for leave", type: "data_input", target: "leave_request" })).ok);
    ok("option -> page", (await A.sd("admin.option.save", { id: "help", caption: "Help", type: "axpert_page", target: "helppage" })).ok);

    console.log("=== Catalog reflects who is asking ===");
    const cats = {};
    for (const [n, c] of [["admin", A], ["priya", P], ["sam", S]]) cats[n] = Object.fromEntries((await c.ask("/cmds", x => x.type === "cmd_catalog")).commands.map(x => [x.name, x]));
    ok("admin: Sandesh, host and admin commands all available", ["me", "cards", "myusers", "admin-users", "admin-activate"].every(k => cats.admin[k].available), cats.admin["admin-users"]);
    ok("host: myusers available; admin-* requires admin",
        cats.priya.myusers.available && !cats.priya["admin-users"].available && cats.priya["admin-users"].requires === "admin");
    ok("host: admin-activate requires manage", cats.priya["admin-activate"].requires === "manage" || cats.priya["admin-activate"].requires === "admin", cats.priya["admin-activate"]);
    ok("employee: cards available; myusers requires host; admin-* requires admin",
        cats.sam.cards.available && cats.sam.myusers.requires === "host" && cats.sam["admin-org"].requires === "admin");

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
    m = await R.hash("reject", String(req2));
    ok("#reject", m.ok && m.data.request.status === "rejected", m);
    m = await R.ask(`#dm ${sam} x`, x => x.type === "error" || x.type === "dm_ack");
    ok("a rejected invitation creates no link", m.type === "error" && m.code === "not_associated", m);
    m = await S.hash("connect", ravi);
    const req3 = m.data.request.id;
    m = await R.hash("ignore", String(req3));
    ok("#ignore", m.ok && m.data.request.status === "ignored", m);
    m = await R.hash("requests", "all");
    ok("#requests all shows accepted, rejected and ignored", ["accepted", "rejected", "ignored"].every(s => m.data.requests.some(q => q.status === s)), m.data.requests?.map(q => q.status));
    m = await R.hash("accept", "99999999");
    ok("#accept of a nonexistent request -> not_found", !m.ok && m.error.code === "not_found", m);

    console.log("=== Hosts: #myusers and #transfer ===");
    m = await P.hash("myusers");
    ok("#myusers: priya hosts ravi and erin", m.ok && [ravi, erin].every(u => m.data.users.some(x => x.username === u)), m);
    ok("#myusers rows say who is online", m.data.users.find(x => x.username === ravi).online === true);
    m = await S.hash("myusers");
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
    m = await A.hash("myusers");
    ok("#myusers: ravi is now the admin's", m.ok && m.data.users.some(x => x.username === ravi), m);
    m = await P.hash("myusers");
    ok("#myusers: and no longer priya's", m.ok && !m.data.users.some(x => x.username === ravi) && m.data.users.some(x => x.username === erin), m);

    console.log("=== Cards: #cards, #dismiss, #remind ===");
    const dmA = await A.ask(`#dm ${sam} hello sam`, x => x.type === "error" || x.type === "dm_ack");
    ok("admin -> sam DM (sam's host is the admin)", dmA.type === "dm_ack", dmA);
    await A.ask(`#dm ${sam} !urgent thing`, x => x.type === "dm_ack");
    await sleep(400);
    m = await S.hash("cards");
    ok("#cards: sam has cards from the admin", m.ok && m.data.cards.length >= 2 && Array.isArray(m.data.sections), m);
    const urgent = m.data.cards.find(c => c.text?.startsWith("!urgent"));
    const plain = m.data.cards.find(c => c.text === "hello sam");
    ok('"!" text lands in the priority section', urgent?.section === "priority", urgent);
    m = await S.hash("cards", "priority");
    ok("#cards <section> filters", m.ok && m.data.cards.length >= 1 && m.data.cards.every(c => c.section === "priority"), m);
    m = await S.hash("cards", "no_such_section");
    ok("#cards for an unknown section -> empty, not an error", m.ok && m.data.cards.length === 0, m);
    m = await S.hash("dismiss", plain.id);
    ok("#dismiss <cardId>", m.ok && m.data.dismissed === true, m);
    m = await S.hash("cards");
    ok("...the card is gone, the other remains", !m.data.cards.some(c => c.id === plain.id) && m.data.cards.some(c => c.id === urgent.id), m);
    m = await S.hash("remind", `call "Priya" \\ about {"x":1} tomorrow`);
    ok("#remind creates a reminder card (quotes/braces/backslash survive)", m.ok && m.data.card.section === "reminders" && m.data.card.text === `call "Priya" \\ about {"x":1} tomorrow`, m);
    m = await S.hash("reminder", "second one", "remind");
    ok("#reminder alias", m.ok, m);
    m = await S.hash("cards", "reminders");
    ok("both reminders are in the reminders section", m.ok && m.data.cards.length === 2, m);
    m = await S.hash("dismiss", "all");
    ok("#dismiss all", m.ok, m);
    m = await S.hash("cards");
    ok("...leaves nothing", m.ok && m.data.cards.length === 0, m);
    m = await S.hash("dismiss", "definitely_not_a_card_id");
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
    m = await S.hash("markread", "personal");
    ok("#markread personal", m.ok, m);
    m = await S.hash("notifications", "personal");
    ok("...personal notifications are now read", m.ok && m.data.notifications.length === 0, m);
    m = await S.hash("notifications", "priority");
    ok("...priority ones are untouched", m.ok && m.data.notifications.length >= 1, m);
    for (const c of ["priority", "pending", "reminders", "all"]) {
        m = await S.hash("markread", c);
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
    P = await new Client(priya).connect(await otpLogin(priya));
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
    m = await A2.hash("cards");
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
    S = await new Client(sam).connect(await otpLogin(sam));

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
