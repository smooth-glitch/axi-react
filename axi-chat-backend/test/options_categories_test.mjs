// Smart Prompts by category: options.categories (the pills + their counts) and the paged, searchable
// options.list (the popup behind a pill). Strict mode, so the "applicable to" rules are really enforced.
//
//   redis-cli -n 4 FLUSHDB
//   REDIS_DB=4 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=1000 \
//   ./run.sh 5566 8099            (or: erl ... -s chat_app start 5566 8099)
//   node test/options_categories_test.mjs http://localhost:8099
//
// Also run by `node test/run_all.mjs options_categories`.

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8099";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
    if (cond) { pass++; console.log("  PASS: " + name); }
    else { fail++; failures.push(name); console.log("  FAIL: " + name + (detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
}

async function post(path, body, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { raw: t }; }
}
const data = (r) => r?.data;

function b32(str) {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of str.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, "0");
    const o = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(o);
}
function totp(secret) {
    const m = Buffer.alloc(8);
    m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const h = crypto.createHmac("sha1", b32(secret)).update(m).digest();
    const off = h[h.length - 1] & 15;
    const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(n % 1000000).padStart(6, "0");
}
async function enrollAndLogin(identifier) {
    let r = await post("/api/sd/login", { identifier });
    if (data(r)?.token) return data(r).token;
    const secret = data(r)?.secret;
    r = await post("/api/sd/login", { identifier, totp: totp(secret) });
    return data(r)?.token;
}

class Client {
    constructor(name) { this.name = name; this.inbox = []; this.seq = 0; }
    async connect(token) {
        this.ws = new WebSocket(WS_URL);
        this.ws.addEventListener("message", (e) => this.inbox.push(JSON.parse(e.data)));
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.ws.send(JSON.stringify({ username: this.name, token }));
        await this.wait((m) => m.type === "welcome", 4000);
        return this;
    }
    async wait(pred, ms = 4000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            const hit = this.inbox.find(pred);
            if (hit) { this.inbox.splice(this.inbox.indexOf(hit), 1); return hit; }
            await sleep(40);
        }
        throw new Error(`timeout waiting for event (${this.name})`);
    }
    async sd(action, args = {}) {
        const reqId = `${this.name}-${++this.seq}`;
        this.ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        return this.wait((m) => m.type === "sd" && m.reqId === reqId);
    }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const cats = async (c, args) => (await c.sd("options.categories", args)).data;
const byId = (list) => Object.fromEntries((list.categories ?? []).map((c) => [c.id, c]));
const counts = (list) => Object.fromEntries((list.categories ?? []).map((c) => [c.id, c.count]));
const page = async (c, args) => (await c.sd("options.list", args));

async function main() {
    console.log(`Options by category against ${BASE}\n`);
    let r = await post("/api/sd/public", undefined);
    r = await (await fetch(BASE + "/api/sd/public")).json();
    if (data(r)?.setupDone) { console.log("This DB is already set up: flush the scratch DB, restart the backend, re-run."); process.exit(2); }

    console.log("=== Setup: org, admin, two departments, users ===");
    const adminName = `oadmin${sfx}`, pw = "Str0ngPass99";
    r = await post("/api/sd/setup/start", { org: "Opt Co", name: "Opt Admin", username: adminName, email: `${adminName}@opt.co`, mobile: "+919886012399" });
    r = await post("/api/sd/setup/verify", { otp: data(r).devOtp });
    const secret = data(r).secret, defPw = data(r).defaultPassword;
    r = await post("/api/sd/login", { identifier: adminName, password: defPw, totp: totp(secret) });
    const t0 = data(r).token;
    await post("/api/sd/password/change", { oldPassword: defPw, newPassword: pw }, t0);
    const adminTok = data(await post("/api/sd/login", { identifier: adminName, password: pw })).token;
    const A = await new Client(adminName).connect(adminTok);
    let m = await A.sd("admin.unlock.start");
    m = await A.sd("admin.unlock", { password: pw, otp: m.data.devOtp });
    ok("admin console unlocked", m.ok, m);
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "Ops" } });
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "Sales" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    const emp = (u, n, dept) => ({ name: n, username: u, email: `${u}@opt.co`, isEmployee: true, branch: "HQ", department: dept, designation: "Analyst" });
    const sam = `osam${sfx}`, tina = `otina${sfx}`;
    ok("Ops user invited", (await A.sd("users.invite", emp(sam, "Sam Ops", "Ops"))).ok);
    ok("Sales user invited", (await A.sd("users.invite", emp(tina, "Tina Sales", "Sales"))).ok);
    const S = await new Client(sam).connect(await enrollAndLogin(sam));
    const T = await new Client(tina).connect(await enrollAndLogin(tina));

    console.log("=== Setup: forms and one option of every kind (some restricted, one inactive) ===");
    for (const f of ["leave_request", "payslip_form", "sales_report"])
        await A.sd("admin.tstruct.save", { name: f, caption: f, fields: [{ name: "q", type: "text", caption: "Q" }] });
    const opt = async (o) => { const x = await A.sd("admin.option.save", o); if (!x.ok) console.log("   option save failed", o.id, JSON.stringify(x.error)); return x; };
    await opt({ id: "o_leave", caption: "Apply Leave", type: "data_input", target: "leave_request", order: 1 });
    await opt({ id: "o_payslip", caption: "payslip", type: "data_input", target: "payslip_form", order: 2, applicable: { departments: ["Ops"] } });
    await opt({ id: "o_sales", caption: "Sales Report", type: "data_input", target: "sales_report", order: 3, applicable: { departments: ["Sales"] } });
    await opt({ id: "o_off", caption: "Retired form", type: "data_input", target: "leave_request", active: false });
    await opt({ id: "o_dl", caption: "Handbook", type: "download" });
    await opt({ id: "o_up", caption: "Send documents", type: "upload" });
    await opt({ id: "o_api", caption: "Sales API", type: "get_data", target: "salesapi", applicable: { departments: ["Sales"] } });
    await opt({ id: "o_pay", caption: "Pay invoice", type: "pay" });
    await opt({ id: "o_ax1", caption: "Axpert IView", type: "axpert_iview", target: "iv1" });
    await opt({ id: "o_ax2", caption: "Axpert Page", type: "axpert_page", target: "pg1" });

    console.log("=== options.categories: one pill per category with a count, per the rules ===");
    let c = await cats(S);
    ok("Ops user: categories come in the fixed pill order", c.categories.map((x) => x.id).join() === "data_input,download,upload,pay,axpert", c.categories.map((x) => x.id));
    ok("Ops user: counts follow the rules (restricted, inactive and other-department options excluded)",
        JSON.stringify(counts(c)) === JSON.stringify({ data_input: 2, download: 1, upload: 1, pay: 1, axpert: 2 }), counts(c));
    ok("Ops user: an empty category (API display) is left out", !("get_data" in counts(c)));
    ok("total equals the sum of the counts", c.total === c.categories.reduce((n, x) => n + x.count, 0) && c.total === 7, c.total);
    ok("each pill carries label, icon, executable and the option types it covers",
        c.categories.every((x) => x.label && x.icon && typeof x.executable === "boolean" && Array.isArray(x.types) && x.types.length >= 1), c.categories[0]);
    ok("Data input / Download / Upload are executable; Pay and Axpert are config only",
        byId(c).data_input.executable && byId(c).download.executable && byId(c).upload.executable && !byId(c).pay.executable && !byId(c).axpert.executable);
    ok("the four Axpert types share one pill", JSON.stringify(byId(c).axpert.types) === JSON.stringify(["axpert_tstruct", "axpert_smartview", "axpert_iview", "axpert_page"]));
    let ct = await cats(T);
    ok("Sales user sees a different set: API display appears, counts differ",
        JSON.stringify(counts(ct)) === JSON.stringify({ data_input: 2, download: 1, upload: 1, get_data: 1, pay: 1, axpert: 2 }), counts(ct));
    ok("Sales user total is 8", ct.total === 8, ct.total);
    let ce = await cats(S, { includeEmpty: true });
    ok("includeEmpty:true returns all six categories, zero counts included", ce.categories.length === 6 && ce.categories.find((x) => x.id === "get_data").count === 0, counts(ce));
    ok("the same rules apply to an admin: the admin account has no department, so department-only options do not count (6)",
        (await cats(A)).total === 6, (await cats(A)).total);

    console.log("=== options.list without arguments is unchanged (all options, now tagged with a category) ===");
    m = await S.sd("options.list");
    ok("legacy call returns the flat list with no paging fields", m.ok && Array.isArray(m.data.options) && m.data.options.length === 7 && m.data.total === undefined, m.data && Object.keys(m.data));
    ok("every option is tagged with its category id", m.data.options.every((o) => typeof o.category === "string" && o.category !== "other"), m.data.options.map((o) => o.category));

    console.log("=== a pill's popup: options.list with category ===");
    m = await page(S, { category: "data_input" });
    ok("the popup lists only that category's options for this user", m.ok && m.data.options.map((o) => o.id).join() === "o_leave,o_payslip" && m.data.total === 2, m.data);
    ok("sorted by the configured order, then caption", m.data.options[0].caption === "Apply Leave" && m.data.options[1].caption === "payslip");
    ok("the paging envelope is present", m.data.page === 1 && m.data.pageSize === 20 && m.data.totalPages === 1 && m.data.hasMore === false && m.data.category === "data_input", m.data);
    m = await page(S, { category: "axpert" });
    ok("the Axpert pill lists all four types' options together", m.data.total === 2 && m.data.options.every((o) => o.category === "axpert"), m.data.options);
    m = await page(S, { category: "axpert_iview" });
    ok("a raw option type also selects its whole category", m.ok && m.data.category === "axpert" && m.data.total === 2, m.data);
    m = await page(S, { category: "get_data" });
    ok("a category with nothing for this user is an empty page, not an error", m.ok && m.data.total === 0 && m.data.options.length === 0 && m.data.totalPages === 1 && m.data.hasMore === false, m.data);
    m = await page(S, { category: "nonsense" });
    ok("an unknown category is refused with the valid ids", !m.ok && m.error.code === "invalid" && /data_input/.test(m.error.message), m.error);
    m = await page(T, { category: "data_input" });
    ok("the rules hold in the popup too: Sales sees Sales Report, not payslip", m.data.options.map((o) => o.id).join() === "o_leave,o_sales", m.data.options.map((o) => o.id));

    console.log("=== search inside a pill ===");
    m = await page(S, { category: "data_input", q: "PAYS" });
    ok("search is case-insensitive on the caption", m.data.total === 1 && m.data.options[0].id === "o_payslip", m.data);
    m = await page(S, { category: "data_input", q: "o_leave" });
    ok("search also matches the option id", m.data.total === 1 && m.data.options[0].id === "o_leave", m.data);
    m = await page(S, { category: "data_input", q: "payslip_form" });
    ok("search also matches the target", m.data.total === 1 && m.data.options[0].id === "o_payslip", m.data);
    m = await page(S, { category: "data_input", q: "  leave  " });
    ok("surrounding spaces are ignored", m.data.total === 1, m.data);
    m = await page(S, { category: "data_input", q: "zzzz" });
    ok("no match -> empty page, total 0", m.ok && m.data.total === 0 && m.data.options.length === 0, m.data);
    m = await page(S, { q: "a" });
    ok("search with no category searches all categories", m.ok && m.data.category === null && m.data.total >= 3, m.data.total);
    m = await page(S, { category: "data_input", q: "leave\u0000\n" });
    ok("control characters in the search text are dropped", m.ok && m.data.total === 1 && m.data.q === "leave", m.data);
    m = await page(S, { category: "data_input", q: "x".repeat(500) });
    ok("an oversized search is cut, not an error", m.ok && m.data.q.length === 100, m.data.q?.length);
    m = await page(S, { category: "data_input", q: 12345 });
    ok("a non-text search is ignored", m.ok && m.data.total === 2, m.data);
    m = await page(S, { category: "data_input", q: "restricted' OR '1'='1" });
    ok("odd characters are just text", m.ok && m.data.total === 0, m.data);

    console.log("=== paging through a big category ===");
    for (let i = 1; i <= 25; i++)
        await opt({ id: `x${String(i).padStart(2, "0")}`, caption: `Extra ${String(i).padStart(2, "0")}`, type: "data_input", target: "leave_request", order: 10 });
    c = await cats(S);
    ok("the badge count grows with the options (2 + 25)", byId(c).data_input.count === 27, byId(c).data_input);
    m = await page(S, { category: "data_input", pageSize: 10 });
    ok("page 1 of 3, ten items, more to come", m.data.options.length === 10 && m.data.total === 27 && m.data.totalPages === 3 && m.data.hasMore === true && m.data.page === 1, m.data);
    const p1 = m.data.options.map((o) => o.id);
    m = await page(S, { category: "data_input", pageSize: 10, page: 2 });
    ok("page 2 is a different set", m.data.page === 2 && m.data.options.length === 10 && m.data.options.every((o) => !p1.includes(o.id)), m.data.options.map((o) => o.id));
    m = await page(S, { category: "data_input", pageSize: 10, page: 3 });
    ok("the last page has the remaining 7 and hasMore false", m.data.options.length === 7 && m.data.hasMore === false && m.data.page === 3, m.data);
    m = await page(S, { category: "data_input", pageSize: 10, page: 99 });
    ok("a page past the end is clamped to the last page", m.data.page === 3 && m.data.options.length === 7, m.data.page);
    m = await page(S, { category: "data_input", pageSize: 10, page: 0 });
    ok("page 0 becomes page 1", m.data.page === 1, m.data.page);
    m = await page(S, { category: "data_input", pageSize: 10, page: "two" });
    ok("junk page falls back to page 1 instead of failing", m.ok && m.data.page === 1, m.data);
    m = await page(S, { category: "data_input", pageSize: 5000 });
    ok("pageSize is capped at 100", m.ok && m.data.pageSize === 100 && m.data.options.length === 27, m.data.pageSize);
    m = await page(S, { category: "data_input", pageSize: -3 });
    ok("a non-positive pageSize becomes 1", m.ok && m.data.pageSize === 1 && m.data.options.length === 1, m.data.pageSize);
    m = await page(S, { category: "data_input", q: "extra 2", pageSize: 3 });
    ok("search and paging combine (Extra 20..25 -> 6 hits, 3 per page)", m.data.total === 6 && m.data.totalPages === 2 && m.data.options.length === 3, m.data);
    m = await page(S, { category: "data_input", pageSize: 100 });
    const ids = m.data.options.map((o) => o.id);
    ok("order: configured order first, then caption A-Z ignoring case", ids.slice(0, 2).join() === "o_leave,o_payslip" && ids[2] === "x01" && ids[26] === "x25", ids.slice(0, 4));
    const allCounts = await cats(S);
    ok("counts still add up to the total after the bulk add", allCounts.total === allCounts.categories.reduce((n, x) => n + x.count, 0) && allCounts.total === 32, allCounts.total);

    console.log("=== live update: counts move when options change (options_changed event) ===");
    S.inbox.length = 0;
    m = await A.sd("admin.option.delete", { id: "x01" });
    ok("admin deletes an option", m.ok, m);
    let evt = null;
    try { evt = await S.wait((e) => e.type === "sd_event" && e.event === "options_changed", 3000); } catch { /* checked below */ }
    ok("the user is told (options_changed) so the pills can refresh", !!evt, "no options_changed event");
    c = await cats(S);
    ok("the badge dropped from 27 to 26", byId(c).data_input.count === 26, byId(c).data_input);
    m = await A.sd("admin.option.save", { id: "o_payslip", caption: "payslip", type: "data_input", target: "payslip_form", order: 2, applicable: { departments: ["Sales"] } });
    c = await cats(S);
    ok("changing who an option applies to moves it out of this user's popup and count", byId(c).data_input.count === 25, byId(c).data_input);
    m = await A.sd("admin.option.save", { id: "o_dl", caption: "Handbook", type: "download", active: false });
    c = await cats(S);
    ok("switching an option off removes the whole Download pill when it was the only one", !("download" in counts(c)), counts(c));

    console.log("=== a user's own options ===");
    m = await S.sd("option.user.save", { id: `mine${sfx}`, caption: "My own upload", type: "upload" });
    ok("a user can make an option of their own", m.ok, m);
    c = await cats(S);
    ok("it counts for its owner", byId(c).upload.count === 2, byId(c).upload);

    console.log("=== access ===");
    m = await S.sd("options.categories", { includeEmpty: "yes" });
    ok("includeEmpty must be the boolean true (anything else = off)", m.ok && m.data.categories.length === (await cats(S)).categories.length, m.data && m.data.categories.length);

    for (const cl of [A, S, T]) cl.close();
    console.log(`\n=== SUMMARY ===\n${pass} passed, ${fail} failed`);
    if (fail) { console.log(failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
}

main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
