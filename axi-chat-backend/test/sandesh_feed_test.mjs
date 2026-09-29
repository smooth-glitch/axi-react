// End-to-end test for the My Workspace notification feed (sd_feed): real notifications produced by
// real events (DMs, approvals, form submissions, reminders, security events), the panel's actions
// (read / unread / resolve / dismiss / clear), filters, live pushes, and the REST + WebSocket surfaces.
//
// Needs a fresh scratch Redis DB (first-run setup can only happen once per DB) and a STRICT backend:
//   REDIS_DB=11 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 \
//   CHAT_RATE_LIMIT_MAX=1000 SANDESH_SCHEDULER_TICK_MS=500 <start the backend>
//   node test/sandesh_feed_test.mjs [http://localhost:PORT]
// (test/run_all.mjs does all of that for you.)

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8082";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
const get = (p, t) => http("GET", p, undefined, t);
const data = (r) => r.json?.data;
const code = (r) => r.json?.error?.code;

function b32decode(str) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of str.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
}
function totpNow(secretB32) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const h = crypto.createHmac("sha1", b32decode(secretB32)).update(msg).digest();
    const o = h[h.length - 1] & 0x0f;
    const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
    return String(bin % 1000000).padStart(6, "0");
}

// Password login + mandatory TOTP enrollment + clearing the default-password flag (see sandesh_test.mjs).
async function enrollAndLogin(identifier, password = `Sandesh${identifier}`) {
    const start = await post("/api/sd/login", { identifier, password });
    const secret = data(start)?.secret;
    const login = await post("/api/sd/login", { identifier, password, totp: secret ? totpNow(secret) : undefined });
    const token = data(login)?.token;
    if (token && data(login)?.mustChangePassword) await post("/api/sd/password/change", { oldPassword: password, newPassword: "NewPass99" }, token);
    return { token };
}

class Client {
    constructor(name) { this.name = name; this.inbox = []; this.waiters = []; this.seq = 0; }
    async connect(token) {
        this.ws = new WebSocket(WS_URL);
        this.ws.addEventListener("message", (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch { m = { type: "__raw__" }; }
            this.inbox.push(m);
            for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].pred(m)) { this.waiters[i].resolve(m); this.waiters.splice(i, 1); }
        });
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.ws.send(JSON.stringify({ username: this.name, token: token ?? "fake", armSessionId: "x" }));
        await this.waitFor(m => m.type === "welcome" || m.type === "error", 3000, "handshake");
        return this;
    }
    send(t) { this.ws.send(t); }
    waitFor(pred, ms = 3000, label = "event") {
        const hit = this.inbox.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (client ${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    async sd(action, args = {}) {
        const reqId = `${this.name}-${++this.seq}`;
        this.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        return this.waitFor(m => m.type === "sd" && m.reqId === reqId, 4000, `reply to ${action}`);
    }
    event(name, ms = 3000) { return this.waitFor(m => m.type === "sd_event" && m.event === name, ms, `sd_event ${name}`); }
    clear() { this.inbox = []; }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}
async function connectAs(name, token) { return new Client(name).connect(token); }

const feedOf = async (token, qs = "") => {
    const r = await get(`/api/sd/feed${qs}`, token);
    if (r.status !== 200) throw new Error(`GET /api/sd/feed${qs} -> ${r.status} ${JSON.stringify(r.json)}`);
    return data(r);
};
const findItem = (list, pred) => list.notifications.find(pred);

async function main() {
    console.log(`Notification feed test against ${BASE}\n`);

    // ---- bootstrap: org, admin, master data, users ------------------------------------------------------
    let r = await post("/api/sd/setup/start", { org: "Feed Corp", name: "Root Admin", username: `root${sfx}`, email: `root${sfx}@acme.com`, mobile: "+919886012345" });
    if (r.status !== 200) { console.log("This DB is already set up (or the backend is down). Use a fresh scratch DB."); process.exit(2); }
    r = await post("/api/sd/setup/verify", { otp: data(r).devOtp });
    const adminName = data(r).user.username, adminSecret = data(r).secret;
    r = await post("/api/sd/login", { identifier: adminName, password: `Sandesh${adminName}`, totp: totpNow(adminSecret) });
    let adminToken = data(r).token;
    await post("/api/sd/password/change", { oldPassword: `Sandesh${adminName}`, newPassword: "Str0ngPass99" }, adminToken);   // -> a "Password changed" security item
    r = await post("/api/sd/login", { identifier: adminName, password: "Str0ngPass99" });
    adminToken = data(r).token;                                                                                              // -> "Signed in on another device"

    let A = await connectAs(adminName, adminToken);
    let m = await A.sd("admin.unlock.start");
    m = await A.sd("admin.unlock", { password: "Str0ngPass99", otp: m.data.devOtp });
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "Bangalore HQ", country: "India", city: "Bangalore", pin: "560001" } });
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "HR", description: "People" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Engineer" } });
    m = await A.sd("admin.tstruct.save", { name: "leave_request", caption: "Leave request", fields: [
        { name: "from_date", type: "date", caption: "From", required: true },
        { name: "to_date", type: "date", caption: "To", required: true },
        { name: "kind", type: "list", caption: "Kind", options: ["Casual", "Sick"], required: true },
    ] });
    ok("bootstrap: form defined", m.ok, m);
    m = await A.sd("admin.option.save", { id: "leave", caption: "Apply for leave", type: "data_input", target: "leave_request" });
    ok("bootstrap: option exposes the form to everyone", m.ok, m);

    const sam = `sam${sfx}`;
    m = await A.sd("users.invite", { name: "Sam W", username: sam, email: `${sam}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer" });
    ok("bootstrap: Sam invited (host = admin)", m.ok, m);
    const S = await enrollAndLogin(sam);
    const SM = await connectAs(sam, S.token);

    // ---- access + shape ---------------------------------------------------------------------------------------
    console.log("=== Access ===");
    r = await get("/api/sd/feed");
    ok("GET /api/sd/feed without a token -> 401", r.status === 401, r.status);
    r = await get("/api/sd/feed", "not-a-token");
    ok("GET /api/sd/feed with a bad token -> 401", r.status === 401, r.status);

    console.log("=== Security events become notifications ===");
    let list = await feedOf(adminToken);
    let pw = findItem(list, n => n.title === "Password changed");
    ok("changing your password creates a low-priority security item", !!pw && pw.priority === "low" && pw.category === "security" && pw.read === false, pw);
    let replaced = findItem(list, n => n.title === "Signed in on another device");
    ok("signing in again (ending your other session) creates a medium security item", !!replaced && replaced.priority === "medium", replaced);
    ok("every item has the panel's shape (id, priority, category, title, message, ts, icon, read, actionType)",
        list.notifications.every(n => n.id && n.priority && n.category && n.title && n.message && Number.isInteger(n.ts) && n.icon && typeof n.read === "boolean" && n.actionType));
    ok("counts are returned with the list", list.counts.total === list.notifications.length && list.counts.unread >= 2 && list.counts.low >= 1 && list.counts.medium >= 1, list.counts);
    list = await feedOf(S.token);
    ok("another user's feed does not contain admin's items", !list.notifications.some(n => n.title === "Signed in on another device" || n.category === "approvals"), list.counts);

    // ---- messages ----------------------------------------------------------------------------------------------
    console.log("=== Messages: coalesced per conversation, live push, open_chat action ===");
    A.clear();
    SM.send(`/msg ${adminName} hello admin`);
    let ev = await A.event("feed_item");
    ok("a DM produces a LIVE feed_item push", ev.data.notification.category === "messages" && ev.data.counts.unread >= 1, ev);
    list = await feedOf(adminToken);
    let dm = findItem(list, n => n.category === "messages");
    ok("DM item: title = sender's name, medium, open_chat action into the right chat", dm.title === "Sam W" && dm.priority === "medium" && dm.actionType === "open_chat" && dm.chatId === `user-${sam}` && dm.message === "hello admin" && dm.count === 1, dm);
    SM.send(`/msg ${adminName} !server is down`);
    await sleep(400);
    list = await feedOf(adminToken);
    const dms = list.notifications.filter(n => n.category === "messages");
    ok("a second message from the same person UPDATES the item (count 2), not a new row", dms.length === 1 && dms[0].count === 2 && dms[0].id === dm.id, dms);
    ok("an urgent message ('!') makes it high priority, latest text shown", dms[0].priority === "high" && dms[0].message === "!server is down", dms[0]);

    // ---- panel actions ---------------------------------------------------------------------------------------------
    console.log("=== Panel actions: read / unread / resolve / dismiss / clear ===");
    A.clear();
    m = await A.sd("feed.read", { ids: [dm.id] });
    ev = await A.event("feed_changed");
    ok("...and pushes feed_changed naming exactly which items changed", ev.data.ids.includes(dm.id) && ev.data.read === true && typeof ev.data.counts.unread === "number", ev);
    ok("feed.read marks it read and returns the counts", m.ok && m.data.updated === 1 && m.data.counts.unread === list.counts.unread - 1, m);
    m = await A.sd("feed.read", { ids: [dm.id], read: false });
    ok("feed.read with read:false marks it unread again (the panel's toggle)", m.ok && m.data.updated === 1 && m.data.counts.unread === list.counts.unread, m);
    A.send(`/read dm ${sam}`);
    await sleep(400);
    list = await feedOf(adminToken);
    ok("opening the DM (/read dm) reads the conversation's item", findItem(list, n => n.id === dm.id).read === true);
    m = await A.sd("feed.read", { ids: [] });
    ok("feed.read with no ids is rejected", !m.ok && m.error.code === "invalid", m);
    m = await A.sd("feed.read", {});
    ok("feed.read with no target is rejected", !m.ok && m.error.code === "invalid", m);

    A.clear();
    m = await A.sd("feed.resolve", { id: dm.id });
    ev = await A.event("feed_item");
    ok("...and pushes the updated item live", ev.data.notification.id === dm.id && ev.data.notification.priority === "resolved", ev);
    ok("feed.resolve turns it green (resolved) and read", m.ok && m.data.notification.priority === "resolved" && m.data.notification.read === true && m.data.counts.resolved === 1, m);
    m = await A.sd("feed.resolve", { id: "no-such-id" });
    ok("resolving an unknown id -> not_found", !m.ok && m.error.code === "not_found", m);
    SM.send(`/msg ${adminName} are you there?`);
    await sleep(400);
    list = await feedOf(adminToken);
    dm = findItem(list, n => n.category === "messages");
    ok("new activity re-opens a resolved conversation (unread, not resolved, count 3)", dm.priority !== "resolved" && dm.read === false && dm.count === 3, dm);
    const beforeBurst = dm.count;
    A.clear();
    for (let i = 0; i < 10; i++) SM.send(`/msg ${adminName} burst ${i}`);
    await A.waitFor(x => x.type === "sd_event" && x.event === "feed_item" && x.data.notification.message === "burst 9", 5000, "last burst push");
    await sleep(300);
    list = await feedOf(adminToken);
    dm = findItem(list, n => n.category === "messages");
    ok("10 messages sent at once are counted exactly (no lost updates: one serialized writer)", dm.count === beforeBurst + 10, { before: beforeBurst, now: dm.count });
    ok("...and the latest one is what the row shows, pushed live", dm.message === "burst 9");
    await A.sd("feed.resolve", { id: dm.id });
    A.clear();
    m = await A.sd("feed.clear");
    ev = await A.event("feed_removed");
    ok("feed.clear removes resolved items and pushes feed_removed", m.ok && m.data.cleared === 1 && ev.data.ids.includes(dm.id) && m.data.counts.resolved === 0, m);
    list = await feedOf(adminToken);
    ok("...and they are gone from the list", !findItem(list, n => n.id === dm.id));
    m = await A.sd("feed.dismiss", { id: pw.id });
    ok("feed.dismiss removes one item", m.ok && m.data.dismissed === true, m);
    m = await A.sd("feed.dismiss", { id: pw.id });
    ok("dismissing it twice -> not_found", !m.ok && m.error.code === "not_found", m);

    // ---- approvals -------------------------------------------------------------------------------------------------------
    console.log("=== Approvals ===");
    A.clear();
    r = await post("/api/sd/register", { name: "Erin E", username: `erin${sfx}`, email: `erin${sfx}@acme.com`, isEmployee: true, branch: "Bangalore HQ", department: "HR", designation: "Engineer", password: "ErinPass99" });
    const erinReq = data(r)?.requestId;
    ok("(setup) Erin self-registers", r.status === 200 && erinReq, r);
    await A.event("feed_item");
    list = await feedOf(adminToken);
    let appr = findItem(list, n => n.category === "approvals");
    ok("the approver gets a HIGH 'approvals' item with the approvals action and the request reference", !!appr && appr.priority === "high" && appr.actionType === "approvals" && appr.ref.requestId === erinReq && /Erin E/.test(appr.message), appr);
    m = await A.sd("req.respond", { id: erinReq, action: "accept" });
    ok("(setup) admin approves Erin", m.ok, m);
    await sleep(300);
    list = await feedOf(adminToken);
    appr = findItem(list, n => n.category === "approvals" && n.ref?.requestId === erinReq);
    ok("answering the approval turns the item green (resolved) and read", appr.priority === "resolved" && appr.read === true, appr);

    // ---- submissions ----------------------------------------------------------------------------------------------------------
    console.log("=== Form submissions ===");
    A.clear();
    m = await SM.sd("tstruct.submit", { name: "leave_request", values: { from_date: "2026-10-01", to_date: "2026-10-03", kind: "Casual" } });
    ok("(setup) Sam submits the leave form", m.ok, m);
    ev = await A.waitFor(x => x.type === "sd_event" && x.event === "feed_item" && x.data.notification.category === "submissions", 3000, "live submission push");
    ok("the admin's open app receives the submission live (no refresh)", ev.data.notification.title === "New submission: leave_request", ev);
    list = await feedOf(adminToken);
    let sub = findItem(list, n => n.category === "submissions");
    ok("the host/admin is told about a new submission (medium, submissions action, form name, who)", !!sub && sub.priority === "medium" && sub.actionType === "submissions" && sub.ref.tstruct === "leave_request" && /Sam W/.test(sub.message), sub);
    list = await feedOf(S.token);
    ok("the submitter is NOT notified about their own submission", !list.notifications.some(n => n.category === "submissions"));

    // ---- reminders ---------------------------------------------------------------------------------------------------------------
    console.log("=== Reminders ===");
    SM.clear();
    m = await SM.sd("reminder.add", { text: "call the vendor" });
    ok("(setup) reminder with no time", m.ok, m);
    m = await SM.sd("reminder.add", { text: "stand-up in a moment", dueTs: Date.now() + 1800 });
    ok("(setup) reminder due in ~2s", m.ok, m);
    await sleep(200);
    list = await feedOf(S.token);
    ok("an immediate reminder shows up at once (medium, reminders)", list.notifications.some(n => n.category === "reminders" && n.message === "call the vendor" && n.priority === "medium"), list.notifications);
    ok("a future reminder is NOT in the feed yet", !list.notifications.some(n => n.message === "stand-up in a moment"));
    ev = await SM.waitFor(x => x.type === "sd_event" && x.event === "feed_item" && x.data.notification.message === "stand-up in a moment", 4000, "live reminder push");
    ok("a reminder is pushed to the open app the moment it is due", ev.data.notification.category === "reminders", ev);
    list = await feedOf(S.token);
    ok("...it appears once it is due", list.notifications.some(n => n.message === "stand-up in a moment"), list.notifications.map(n => n.message));

    // ---- filters + paging ----------------------------------------------------------------------------------------------------------
    console.log("=== Filters ===");
    const all = await feedOf(adminToken);
    const highs = await feedOf(adminToken, "?priority=high");
    ok("?priority=high returns only high items", highs.notifications.every(n => n.priority === "high"), highs.notifications.map(n => n.priority));
    const resolvedOnly = await feedOf(adminToken, "?priority=resolved");
    ok("?priority=resolved returns only resolved items", resolvedOnly.notifications.length >= 1 && resolvedOnly.notifications.every(n => n.priority === "resolved"));
    const cat = await feedOf(adminToken, "?category=security");
    ok("?category= filters by category", cat.notifications.length >= 1 && cat.notifications.every(n => n.category === "security"));
    const unread = await feedOf(adminToken, "?unreadOnly=true");
    ok("?unreadOnly=true returns only unread items", unread.notifications.every(n => n.read === false) && unread.notifications.length === all.counts.unread, unread.counts);
    const one = await feedOf(adminToken, "?limit=1");
    ok("?limit=1 returns one item and hasMore", one.notifications.length === 1 && one.hasMore === true && one.counts.total === all.counts.total);
    const older = await feedOf(adminToken, `?limit=1&before=${one.notifications[0].ts}`);
    ok("?before=<ts> pages to older items", older.notifications.length === 1 && older.notifications[0].ts <= one.notifications[0].ts && older.notifications[0].id !== one.notifications[0].id);
    ok("items are newest activity first", all.notifications.every((n, i, a) => i === 0 || a[i - 1].ts >= n.ts));
    m = await A.sd("feed.list", { priority: "purple" });
    ok("an unknown priority is rejected", !m.ok && m.error.code === "invalid", m);
    r = await get("/api/sd/feed/summary", adminToken);
    ok("GET /api/sd/feed/summary matches the counts", r.status === 200 && data(r).total === all.counts.total && data(r).unread === all.counts.unread, data(r));
    m = await A.sd("me");
    ok("/sd me carries the feed counts (one call = whole header)", m.ok && m.data.feed && m.data.feed.total === all.counts.total, m.data?.feed);

    // ---- REST mutations mirror the WebSocket ones ----------------------------------------------------------------------------------------
    console.log("=== REST mutations ===");
    const target = all.notifications.find(n => n.read === false);
    r = await post("/api/sd/feed/read", { ids: [target.id] }, adminToken);
    ok("POST /feed/read marks read", r.status === 200 && data(r).updated === 1, r.json);
    r = await post("/api/sd/feed/resolve", { id: target.id }, adminToken);
    ok("POST /feed/resolve resolves", r.status === 200 && data(r).notification.priority === "resolved", r.json);
    r = await post("/api/sd/feed/resolve", {}, adminToken);
    ok("POST /feed/resolve without id -> 400", r.status === 400 && code(r) === "invalid", r.json);
    r = await post("/api/sd/feed/dismiss", { id: target.id }, adminToken);
    ok("POST /feed/dismiss dismisses", r.status === 200, r.json);
    r = await post("/api/sd/feed/read", { all: true }, adminToken);
    ok("POST /feed/read {all:true} clears every unread", r.status === 200 && data(r).counts.unread === 0, r.json);
    r = await post("/api/sd/feed/clear", {}, adminToken);
    ok("POST /feed/clear removes resolved items", r.status === 200 && data(r).counts.resolved === 0, r.json);
    r = await post("/api/sd/feed/read", { all: true });
    ok("POST /feed/* without a token -> 401", r.status === 401);

    // ---- offline delivery -----------------------------------------------------------------------------------------------------------------
    console.log("=== Offline user ===");
    A.close(); await sleep(300);
    SM.send(`/msg ${adminName} sent while you were away`);
    await sleep(500);
    list = await feedOf(adminToken);
    ok("a message sent while the user is offline is waiting in the feed", !!findItem(list, n => n.message === "sent while you were away"), list.notifications.map(n => n.message));

    // ---- account lock (last: it locks the admin out of signing in; only admins are password-checked) ----------------------------------------------------------------------------------
    console.log("=== Account lock ===");
    for (let i = 0; i < 5; i++) await post("/api/sd/login", { identifier: adminName, password: "definitely-wrong-1" });
    r = await post("/api/sd/login", { identifier: adminName, password: "Str0ngPass99" });
    ok("(setup) the admin really is locked out now", r.status === 429 || code(r) === "locked", r.json);
    list = await feedOf(adminToken);
    const lock = findItem(list, n => n.title === "Account temporarily locked");
    ok("repeated failed sign-ins raise a HIGH security item for the account holder", !!lock && lock.priority === "high" && lock.category === "security", lock);

    SM.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
    process.exit(0);
}

main().catch((e) => { console.error("TEST CRASHED:", e.stack.split("\n").slice(0, 4).join(" | ")); process.exit(1); });
