// #list: records.list -- search, date range, scope, paging, visibility.
import { suite, bootstrap, seedOrg, sfx, sleep } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8097";
const t = suite("connectum_records", BASE);
const { ok } = t;

async function main() {
    const B = await bootstrap(BASE);
    const { A, connectUser } = B;
    const [u1, u2] = [`rua${sfx}`, `rub${sfx}`];
    await seedOrg(A, [[u1, "Rua One", "Ops"], [u2, "Rub Two", "Ops"]]);
    const U1 = await connectUser(u1), U2 = await connectUser(u2);
    let m = await A.sd("admin.tstruct.save", { name: "visit", caption: "Visit", fields: [{ name: "patient", type: "text", caption: "Patient" }, { name: "qty", type: "number", caption: "Qty" }] });
    ok("structure created", m.ok, m);
    await A.sd("admin.option.save", { id: "visit_opt", caption: "Visit", type: "data_input", target: "visit" });
    const sub = (c, patient, qty) => c.sd("tstruct.submit", { tstruct: "visit", name: "visit", values: { patient, qty } });
    const made = [];
    for (const [c, p, q] of [[U1, "Asha Rao", 1], [U1, "Bala Menon", 2], [U2, "Chen Wu", 3], [U1, "Asha Iyer", 4], [U2, "Dev Patel", 5]]) {
        const r = await sub(c, p, q); made.push(r); await sleep(5);
    }
    ok("five records saved", made.every((r) => r.ok), made.find((r) => !r.ok));
    t.section("records.list");
    m = await U1.sd("records.list", { tstruct: "visit" });
    ok("a person sees only their own records (3), newest first", m.ok && m.data.total === 3 && m.data.records[0].values.patient === "Asha Iyer", m);
    m = await U1.sd("records.list", { tstruct: "visit", q: "asha" });
    ok("search matches any value, ignoring case", m.ok && m.data.total === 2, m.data);
    m = await U1.sd("records.list", { tstruct: "visit", q: "menon" });
    ok("search narrows to one", m.ok && m.data.total === 1 && m.data.records[0].values.patient === "Bala Menon", m.data);
    m = await U1.sd("records.list", { tstruct: "visit", q: "zzz" });
    ok("no match is an empty page", m.ok && m.data.total === 0 && m.data.records.length === 0 && m.data.hasMore === false, m.data);
    m = await U1.sd("records.list", { tstruct: "visit", limit: 2 });
    ok("paging: first page has 2 and hasMore", m.ok && m.data.records.length === 2 && m.data.hasMore === true && m.data.total === 3, m.data);
    m = await U1.sd("records.list", { tstruct: "visit", limit: 2, offset: 2 });
    ok("paging: second page has the last one", m.ok && m.data.records.length === 1 && m.data.hasMore === false, m.data);
    m = await U1.sd("records.list", { tstruct: "visit", offset: 50 });
    ok("offset past the end is empty, not an error", m.ok && m.data.records.length === 0, m);
    m = await U1.sd("records.list", { tstruct: "visit", limit: 100000 });
    ok("limit is capped at 100", m.ok && m.data.limit === 100, m.data);
    m = await U1.sd("records.list", { tstruct: "visit", from: Date.now() + 100000 });
    ok("date range: nothing after a future time", m.ok && m.data.total === 0, m.data);
    m = await U1.sd("records.list", { tstruct: "visit", to: Date.now() + 100000 });
    ok("date range: everything before a future time", m.ok && m.data.total === 3, m.data);
    m = await A.sd("records.list", { tstruct: "visit" });
    ok("an administrator sees all five", m.ok && m.data.total === 5, m.data);
    m = await A.sd("records.list", { tstruct: "visit", scope: "mine" });
    ok("scope 'mine' limits an administrator to their own (none)", m.ok && m.data.total === 0, m.data);
    m = await U2.sd("records.list", { tstruct: "visit", q: "asha" });
    ok("others' records never leak through search", m.ok && m.data.total === 0, m.data);
    m = await U1.sd("records.list", {});
    ok("tstruct is required", !m.ok && m.error.code === "invalid", m.error);
    m = await U1.sd("records.list", { tstruct: "nope" });
    ok("an unknown structure is just empty", m.ok && m.data.total === 0, m);
    for (const c of [A, U1, U2]) c.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
