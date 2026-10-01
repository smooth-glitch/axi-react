// Hosts are only visible to the people they are for; reportingManager can't be chosen at sign-up;
// submissions are listed completely (paged, host history, busy forms); status reaches people who connect later.
//
//   redis-cli -n 44 FLUSHDB    (run_all starts Redis with 64 databases)
//   REDIS_DB=44 SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=20000 erl ... -s chat_app start 5610 8120
//   node test/backend_followups_test.mjs http://localhost:8120
//
// Runs in OPEN mode (the default, and what the VM uses): the host rule must hold there too.
// Also run by `node test/run_all.mjs backend_followups`.

import { suite, bootstrap, sfx, api, sleep } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8120";
const t = suite("backend_followups", BASE);
const { ok } = t;

async function main() {
    console.log(`Host scoping, sign-up, submissions and profiles against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const { A, connectUser, http } = B;
    const n = (x) => `${x}${sfx}`;
    const [hOps, hOps2, hSales, raj, sam, cov] = [n("hops"), n("hops2"), n("hsales"), n("raj"), n("sam"), n("cov")];

    for (const d of ["Ops", "Sales"]) await A.sd("admin.cfg.save", { kind: "departments", item: { name: d } });
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    const scope = (dept) => ({ employees: { any: false, branches: [], departments: [dept], designations: [] }, affiliates: { any: false, selected: [] }, categories: [] });
    const emp = (u, name, dept, extra = {}) => A.sd("users.invite", { name, username: u, email: `${u}@test.co`, isEmployee: true, branch: "HQ", department: dept, designation: "Analyst", ...extra });
    for (const [u, nm, d] of [[hOps, "Host Ops", "Ops"], [hOps2, "Host Ops Two", "Ops"], [hSales, "Host Sales", "Sales"]]) await emp(u, nm, d, { isHost: true, hostScope: scope(d) });
    await emp(raj, "Raj Rao", "Ops", { host: hOps });
    await emp(sam, "Sam Sen", "Sales", { host: hSales });
    await emp(cov, "Cov Cole", "Ops");                       // no host given: assigned to the admin who invited them
    const [Raj, Sam, Cov, HOps, HOps2, HSales] = await Promise.all([raj, sam, cov, hOps, hOps2, hSales].map((u) => connectUser(u)));
    const names = (m) => (m.data?.hosts ?? m.data?.users ?? []).map((u) => u.username);

    t.section("My hosts: only the hosts that cover me");
    let m = await Raj.sd("hosts.mine");
    ok("an Ops person gets their assigned Ops host and the other Ops host", m.ok && names(m).includes(hOps) && names(m).includes(hOps2), m);
    ok("...and never the Sales host", !names(m).includes(hSales), names(m));
    ok("...each marked assigned or covering", m.data.hosts.find((h) => h.username === hOps)?.relation === "assigned" && m.data.hosts.find((h) => h.username === hOps2)?.relation === "covering", m.data.hosts.map((h) => [h.username, h.relation]));
    m = await Sam.sd("hosts.mine");
    ok("a Sales person gets only the Sales host", m.ok && names(m).join() === hSales, names(m));
    m = await Cov.sd("hosts.mine");
    ok("someone assigned to the admin sees the admin plus the hosts that cover them", names(m).includes(B.adminName) && names(m).includes(hOps) && !names(m).includes(hSales), names(m));
    m = await Raj.sd("hosts.mine");
    ok("the answer carries who they are and whether they are online", m.data.hosts.every((h) => h.name && "online" in h), m.data.hosts[0]);

    t.section("Search: other departments' hosts stay hidden");
    m = await Raj.sd("users.search", { q: "Host" });
    ok("Raj finds his Ops hosts by name", names(m).includes(hOps) && names(m).includes(hOps2), names(m));
    ok("...but not the Sales host", !names(m).includes(hSales), names(m));
    m = await Raj.sd("users.search", { q: "Sam" });
    ok("ordinary colleagues are still searchable", names(m).includes(sam), names(m));
    m = await Raj.sd("users.search", { q: hSales });
    ok("even typing the Sales host's exact username finds nothing", !names(m).includes(hSales), names(m));
    m = await A.sd("users.search", { q: "Host" });
    ok("an administrator sees every host", [hOps, hOps2, hSales].every((h) => names(m).includes(h)), names(m));
    m = await HOps.sd("users.search", { q: "Host" });
    ok("hosts see each other (they are staff)", names(m).includes(hSales) && names(m).includes(hOps2), names(m));
    m = await Sam.sd("users.search", { q: "Host" });
    ok("Sam sees his own host", names(m).includes(hSales) && !names(m).includes(hOps), names(m));

    t.section("Messaging a host is scoped the same way");
    const dm = async (from, to, text) => { from.inbox.length = 0; from.send(`/msg ${to} ${text}`); return from.wait((x) => x.type === "dm_ack" || x.type === "error", 4000); };
    let r = await dm(Raj, hOps, "hello host");
    ok("Raj can message his own host", r?.type === "dm_ack", r);
    r = await dm(Raj, hOps2, "hello other ops host");
    ok("...and the other host who covers him", r?.type === "dm_ack", r);
    r = await dm(Raj, hSales, "hello sales host");
    ok("...but not a host who isn't for him (refused, nothing sent)", r?.type === "error" && r.code === "not_associated", r);
    r = await dm(Raj, sam, "hi Sam");
    ok("ordinary colleagues can still be messaged", r?.type === "dm_ack", r);
    r = await dm(HSales, raj, "hello Raj");
    ok("a host can message the people (even outside their scope)", r?.type === "dm_ack", r);
    r = await dm(HOps, hSales, "host to host");
    ok("hosts can message each other", r?.type === "dm_ack", r);
    Raj.inbox.length = 0; Raj.send(`/hostmsg ${hSales} hi`);
    r = await Raj.wait((x) => x.type === "error" || x.type === "host_ack", 3000);
    ok("the host-channel send is not a back door (no such department host, so a clean error)", r?.type === "error", r);

    t.section("Reporting manager can't be chosen at sign-up");
    const code = (await A.sd("admin.org.get")).data?.org?.code ?? (await A.sd("admin.org.get")).data?.code;
    const reg = await http.post("/api/sd/register", { code, name: "Newbie Nair", username: n("newbie"), email: `${n("newbie")}@test.co`, mobile: "+919876500123", password: "Str0ngPass99x",
        isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst", reportingManager: hOps, country: "India", city: "Pune", pin: "411001" });
    ok("sign-up still works when a manager is sent", reg.status === 200 && reg.data?.registered === true, reg.json);
    const newbie = (await A.sd("admin.user.get", { username: n("newbie") })).data.user;
    ok("...but the manager they named is ignored", newbie.reportingManager === null, newbie.reportingManager);
    m = await A.sd("admin.user.update", { username: n("newbie"), reportingManager: hOps });
    ok("an administrator can still set it", m.ok && m.data.user.reportingManager === hOps, m);
    m = await HOps.sd("users.invite", { name: "Ivy Iyer", username: n("ivy"), email: `${n("ivy")}@test.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst", reportingManager: hOps });
    ok("and a host can set it when inviting", m.ok && m.data.user.reportingManager === hOps, m.error ?? m.data);

    t.section("Submissions: nothing disappears");
    await A.sd("admin.tstruct.save", { name: "survey", caption: "Survey", fields: [{ name: "n", type: "wholenumber", caption: "N" }] });
    await A.sd("admin.option.save", { id: "survey_opt", caption: "Survey", type: "data_input", target: "survey" });
    const submit = (c, i) => c.sd("tstruct.submit", { tstruct: "survey", name: "survey", values: { n: i } });
    for (let i = 1; i <= 5; i++) await submit(Raj, i);                       // Raj's, the oldest
    await sleep(15);
    for (let i = 0; i < 70; i++) { await submit(Sam, i); await submit(Cov, i); await submit(HOps2, i); }   // 210 newer ones from others
    m = await Raj.sd("submissions.list", { tstruct: "survey" });
    ok("a busy form: Raj still sees all 5 of his own, even though 210 newer ones exist from others", m.ok && m.data.submissions.length === 5 && m.data.submissions.every((s) => s.by === raj), { got: m.data?.submissions?.length });
    ok("...and the reply says how many there are and whether more follow", m.data.total === 5 && m.data.hasMore === false, { total: m.data.total, hasMore: m.data.hasMore });
    for (let i = 6; i <= 125; i++) await submit(Raj, i);                      // 125 of his own in total
    m = await Raj.sd("submissions.list", {});
    ok("the default list now returns up to 500 (all 125 here), newest first, and says nothing more follows", m.ok && m.data.submissions.length === 125 && m.data.hasMore === false && m.data.total === 125, { len: m.data?.submissions?.length, total: m.data?.total, more: m.data?.hasMore });
    m = await Raj.sd("submissions.list", { limit: 100 });
    ok("with limit 100 it says there are more", m.data.submissions.length === 100 && m.data.hasMore === true && m.data.total === 125, { len: m.data.submissions.length, more: m.data.hasMore });
    let m2 = await Raj.sd("submissions.list", { limit: 100, offset: 100 });
    ok("paging on gets the rest (25), with no overlap", m2.data.submissions.length === 25 && m2.data.hasMore === false && !m2.data.submissions.some((s) => m.data.submissions.some((x) => x.id === s.id)), { len: m2.data.submissions.length });
    m = await Raj.sd("submissions.list", { tstruct: "survey", limit: 10, offset: 0 });
    ok("limit works with a structure filter", m.data.submissions.length === 10 && m.data.total === 125 && m.data.hasMore === true, { total: m.data.total });
    const all = [];
    for (let off = 0; off < 125; off += 50) all.push(...(await Raj.sd("submissions.list", { tstruct: "survey", limit: 50, offset: off })).data.submissions);
    ok("walking every page returns each of the 125 exactly once, newest first", new Set(all.map((s) => s.id)).size === 125 && all.every((s, i) => i === 0 || all[i - 1].ts >= s.ts), { n: all.length });
    m = await Raj.sd("submissions.list", { limit: 9999 });
    ok("limit is capped sensibly", m.data.limit === 500, m.data.limit);

    t.section("Hosts see the history of the people they host now");
    m = await HOps.sd("submissions.list", { tstruct: "survey", limit: 500 });
    ok("Raj's host sees Raj's submissions", m.data.submissions.filter((s) => s.by === raj).length === 125, { n: m.data.submissions.filter((s) => s.by === raj).length });
    ok("...and nobody else's (Sam and Cov belong to other hosts)", m.data.submissions.every((s) => s.by === raj || s.by === hOps || s.by === hOps2) && !m.data.submissions.some((s) => s.by === sam), [...new Set(m.data.submissions.map((s) => s.by))]);
    await A.sd("admin.host.change", { user: raj, host: hOps2 });
    m = await HOps2.sd("submissions.list", { tstruct: "survey", limit: 500 });
    ok("after Raj is moved to another host, the NEW host sees his whole history", m.data.submissions.filter((s) => s.by === raj).length === 125, { n: m.data.submissions.filter((s) => s.by === raj).length });
    m = await HSales.sd("submissions.list", { tstruct: "survey", limit: 500 });
    ok("an unrelated host sees none of Raj's", !m.data.submissions.some((s) => s.by === raj), [...new Set(m.data.submissions.map((s) => s.by))]);
    m = await A.sd("submissions.list", { tstruct: "survey", limit: 500 });
    ok("an administrator sees everything of the structure (125 + 210 = 335)", m.data.total === 335 && m.data.submissions.length === 335, { total: m.data.total, len: m.data.submissions.length });

    t.section("Edit and delete keep the lists consistent");
    const mine = (await Raj.sd("submissions.list", { tstruct: "survey", limit: 500 })).data.submissions;
    const target = mine[0];
    m = await Raj.sd("submissions.update", { id: target.id, values: { n: 9999 } });
    ok("editing works", m.ok, m.error);
    let after = (await Raj.sd("submissions.list", { tstruct: "survey", limit: 500 })).data;
    ok("...it appears once, edited, and the count is unchanged", after.total === 125 && after.submissions.filter((s) => s.id === target.id).length === 1 && after.submissions.find((s) => s.id === target.id).values.n === 9999, { total: after.total });
    m = await Raj.sd("submissions.delete", { id: target.id });
    ok("deleting works", m.ok, m.error);
    after = (await Raj.sd("submissions.list", { tstruct: "survey", limit: 500 })).data;
    ok("...it is gone from Raj's list and the count drops by one", after.total === 124 && !after.submissions.some((s) => s.id === target.id), { total: after.total });
    ok("...and from his host's list", !(await HOps2.sd("submissions.list", { tstruct: "survey", limit: 500 })).data.submissions.some((s) => s.id === target.id));
    ok("...and from the administrator's", !(await A.sd("submissions.list", { tstruct: "survey", limit: 500 })).data.submissions.some((s) => s.id === target.id));
    m = await Sam.sd("submissions.update", { id: mine[1].id, values: { n: 1 } });
    ok("nobody else can edit someone's submission", !m.ok && m.error.code === "forbidden", m.error);

    t.section("Status reaches people who connect later");
    Raj.inbox.length = 0; Raj.send("/setstatus In a meeting"); await sleep(400);
    Raj.send("/setavatar https://example.com/raj.png"); await sleep(400);
    const isProfile = (u) => (x) => x.type === "profile" && x.user === u;
    // a brand new colleague who connects now: they know Raj only because he is online
    await A.sd("users.invite", { name: "Late Lal", username: n("late2"), email: `${n("late2")}@test.co`, isEmployee: true, branch: "HQ", department: "Sales", designation: "Analyst", host: hSales });
    const Late = await connectUser(n("late2"));
    const p = await Late.wait(isProfile(raj), 3000);
    ok("someone connecting while Raj is online is told his status and picture", p?.status === "In a meeting" && p?.avatar === "https://example.com/raj.png", p);
    Raj.close(); await sleep(600);
    // a fresh connection of Raj's own host while Raj is OFFLINE: the host knows him as one of their people
    HOps2.close(); await sleep(400);
    const again = await B.enroll(hOps2).then((tok) => new (HOps2.constructor)(BASE, hOps2).connect(tok)).catch(() => null);
    const p2 = again ? await again.wait(isProfile(raj), 3000) : null;
    ok("a host who reconnects is told the status of their (offline) people", p2?.status === "In a meeting", p2);
    ok("people with no status and no picture are not announced", !(Late.inbox.some((x) => x.type === "profile" && x.user === cov)), Late.inbox.filter((x) => x.type === "profile").map((x) => x.user));

    for (const c of [A, Raj, Sam, Cov, HOps, HSales, Late, again].filter(Boolean)) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
