// The same host rules in STRICT mode (what the spec describes): hosts are visible only to the people they are for;
// a DM needs an association; the host channel and search follow the same visibility.
//
//   redis-cli -n 46 FLUSHDB
//   REDIS_DB=46 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=5000 erl ... -s chat_app start 5630 8140
//   node test/host_scoping_strict_test.mjs http://localhost:8140
//
// Also run by `node test/run_all.mjs host_scoping_strict`.

import { suite, bootstrap, sfx } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8140";
const t = suite("host_scoping_strict", BASE);
const { ok } = t;

async function main() {
    console.log(`Host scoping in strict mode against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const { A, connectUser } = B;
    const n = (x) => `${x}${sfx}`;
    const [hOps, hOps2, hSales, raj, sam] = [n("hops"), n("hops2"), n("hsales"), n("raj"), n("sam")];
    for (const d of ["Ops", "Sales"]) await A.sd("admin.cfg.save", { kind: "departments", item: { name: d } });
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    const scope = (d) => ({ employees: { any: false, branches: [], departments: [d], designations: [] }, affiliates: { any: false, selected: [] }, categories: [] });
    const emp = (u, name, dept, extra = {}) => A.sd("users.invite", { name, username: u, email: `${u}@test.co`, isEmployee: true, branch: "HQ", department: dept, designation: "Analyst", ...extra });
    for (const [u, nm, d] of [[hOps, "Host Ops", "Ops"], [hOps2, "Host Ops Two", "Ops"], [hSales, "Host Sales", "Sales"]]) await emp(u, nm, d, { isHost: true, hostScope: scope(d) });
    await emp(raj, "Raj Rao", "Ops", { host: hOps });
    await emp(sam, "Sam Sen", "Sales", { host: hSales });
    const [Raj, Sam, HOps] = await Promise.all([raj, sam, hOps].map((u) => connectUser(u)));
    const names = (m) => (m.data?.hosts ?? m.data?.users ?? []).map((u) => u.username);

    t.section("My hosts");
    let m = await Raj.sd("hosts.mine");
    ok("Raj gets his assigned host and the other Ops host, not the Sales host", m.ok && names(m).includes(hOps) && names(m).includes(hOps2) && !names(m).includes(hSales), names(m));
    m = await Sam.sd("hosts.mine");
    ok("Sam gets only the Sales host", m.ok && names(m).join() === hSales, names(m));

    t.section("Search (strict: exact username only)");
    m = await Raj.sd("users.search", { q: hOps });
    ok("Raj finds his host by exact username", names(m).includes(hOps), names(m));
    m = await Raj.sd("users.search", { q: hSales });
    ok("...but a Sales host stays hidden even by exact username", !names(m).includes(hSales), names(m));
    m = await Raj.sd("users.search", { q: sam });
    ok("an ordinary colleague is found by exact username", names(m).includes(sam), names(m));
    m = await A.sd("users.search", { q: hSales });
    ok("an administrator finds any host", names(m).includes(hSales), names(m));
    m = await HOps.sd("users.search", { q: hSales });
    ok("another host finds a host", names(m).includes(hSales), names(m));

    t.section("Direct messages");
    const dm = async (from, to, text) => { from.inbox.length = 0; from.send(`/msg ${to} ${text}`); return from.wait((x) => x.type === "dm_ack" || x.type === "error", 4000); };
    let r = await dm(Raj, hOps, "hi host");
    ok("Raj can message his assigned host", r?.type === "dm_ack", r);
    r = await dm(Raj, hSales, "hi sales host");
    ok("Raj cannot message a host who isn't for him", r?.type === "error" && r.code === "not_associated", r);
    r = await dm(Raj, hOps2, "hi other ops host");
    ok("strict mode still needs an association even for a covering host (spec: only your host)", r?.type === "error" && r.code === "not_associated", r);
    r = await dm(HOps, raj, "hello Raj");
    ok("a host can message the people they host", r?.type === "dm_ack", r);
    Raj.inbox.length = 0; Raj.send(`/hostmsg ${hSales} hi`);
    r = await Raj.wait((x) => x.type === "error" || x.type === "host_ack", 3000);
    ok("the host channel gives a clean error, not a way around the rule", r?.type === "error", r);

    t.section("Sign-up");
    m = await A.sd("admin.user.update", { username: raj, reportingManager: hOps });
    ok("an administrator can still set the reporting manager", m.ok && m.data.user.reportingManager === hOps, m.error);

    for (const c of [A, Raj, Sam, HOps]) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
