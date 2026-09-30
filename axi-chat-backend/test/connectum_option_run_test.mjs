// option.run: get_data (table / name-value / text), pay (states, verification, webhook), and the other types.
import http from "node:http";
import { suite, bootstrap, seedOrg, sfx } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8101";
const t = suite("connectum_option_run", BASE);
const { ok } = t;
const SECRET = "whsecret-123";

function startApp() {
    const server = http.createServer((req, res) => {
        let body = ""; req.on("data", (c) => (body += c));
        req.on("end", () => {
            const j = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
            if (req.url === "/query") {
                const q = JSON.parse(body);
                if (/payments/.test(q.sql)) return j({ columns: ["id"], rows: q.params.reference === "GOOD-REF" ? [[1]] : [] });
                return j({ columns: ["name", "balance", "vip"], rows: [["Asha", 1200.5, true], ["Bala", 30, false]] });
            }
            res.writeHead(404); res.end("{}");
        });
    });
    return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

async function main() {
    const app = await startApp();
    const { A, connectUser } = await bootstrap(BASE);
    const [u, v] = [`ord${sfx}`, `ore${sfx}`];
    await seedOrg(A, [[u, "Ord One", "Ops"], [v, "Ore Two", "Sales"]]);
    const U = await connectUser(u), V = await connectUser(v);
    await A.sd("admin.appconn.save", { name: "erp", url: `http://127.0.0.1:${app.port}`, authType: "none" });
    await A.sd("datasource.save", { name: "balances", type: "sql", connection: "erp", sql: "SELECT name, balance, vip FROM accounts" });
    await A.sd("datasource.save", { name: "verify_pay", type: "sql", connection: "erp", sql: "SELECT id FROM payments WHERE ref = :reference", params: [{ name: "reference" }] });

    t.section("get_data");
    for (const [id, display] of [["bal_table", "table"], ["bal_nv", "name_value"], ["bal_text", "text"]])
        await A.sd("admin.option.save", { id, caption: id, type: "get_data", target: "balances", display });
    let m = await U.sd("option.run", { id: "bal_table" });
    ok("table: columns and rows", m.ok && m.data.display === "table" && m.data.result.columns.join() === "name,balance,vip" && m.data.result.rows.length === 2, m);
    m = await U.sd("option.run", { id: "bal_nv" });
    ok("name_value: the first row as name/value pairs", m.ok && m.data.result.pairs.length === 3 && m.data.result.pairs[1].name === "balance" && m.data.result.pairs[1].value === 1200.5, m.data);
    m = await U.sd("option.run", { id: "bal_text" });
    ok("text: readable lines", m.ok && m.data.result.text.includes("name: Asha") && m.data.result.text.includes("vip: true") && m.data.result.text.includes("\n\n"), m.data);
    await A.sd("admin.option.save", { id: "bal_sales", caption: "S", type: "get_data", target: "balances", applicable: { departments: ["Sales"] } });
    m = await U.sd("option.run", { id: "bal_sales" });
    ok("an option that doesn't apply to you can't be run", !m.ok && m.error.code === "not_found", m.error);
    ok("...but does for the department it targets", (await V.sd("option.run", { id: "bal_sales" })).ok);
    await A.sd("admin.option.save", { id: "bal_off", caption: "Off", type: "get_data", target: "balances", active: false });
    m = await U.sd("option.run", { id: "bal_off" });
    ok("an inactive option can't be run", !m.ok && m.error.code === "not_found", m.error);
    await A.sd("admin.option.save", { id: "bal_free", caption: "Free text target", type: "get_data", target: "some old label" });
    m = await U.sd("option.run", { id: "bal_free" });
    ok("an option whose target isn't a data source says it isn't connected", !m.ok && m.error.code === "not_configured", m.error);
    m = await U.sd("option.run", { id: "nope" });
    ok("an unknown option is not_found", !m.ok && m.error.code === "not_found", m.error);

    t.section("Other option types");
    await A.sd("admin.tstruct.save", { name: "f1", caption: "F1", fields: [{ name: "a", type: "text", caption: "A" }] });
    await A.sd("admin.option.save", { id: "in1", caption: "Form", type: "data_input", target: "f1" });
    m = await U.sd("option.run", { id: "in1" });
    ok("data_input tells the client which form to open", m.ok && m.data.open === "tstruct" && m.data.target === "f1", m);
    await A.sd("admin.option.save", { id: "ax1", caption: "Axpert", type: "axpert_iview", target: "iv1" });
    m = await U.sd("option.run", { id: "ax1" });
    ok("Axpert options say clearly they aren't supported here", !m.ok && m.error.code === "not_supported", m.error);

    t.section("Pay: options and payments");
    for (const [what, o] of [["a negative amount", { amount: -5 }], ["a text amount", { amount: "ten" }], ["an unknown verifying data source", { verifyDatasource: "ghost" }]]) {
        m = await A.sd("admin.option.save", { id: "badpay", caption: "x", type: "pay", ...o });
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    m = await A.sd("admin.option.save", { id: "fee", caption: "Pay fee", type: "pay", amount: 250, description: "Consult fee", verifyDatasource: "verify_pay" });
    ok("a pay option keeps its amount, currency and description", m.ok && m.data.option.amount === 250 && m.data.option.currency === "INR" && m.data.option.description === "Consult fee", m);
    await A.sd("admin.option.save", { id: "donate", caption: "Donate", type: "pay" });
    await A.sd("admin.option.save", { id: "fee_manual", caption: "Manual", type: "pay", amount: 10 });
    m = await U.sd("options.list");
    ok("options.list is unchanged for pay options (no new keys)", m.ok && Object.keys(m.data.options.find((o) => o.id === "fee")).sort().join() === "caption,category,display,id,order,owner,target,targetScope,type", m.data.options.find((o) => o.id === "fee"));
    m = await U.sd("option.run", { id: "fee" });
    ok("running a pay option creates a payment for the fixed amount", m.ok && m.data.payment.amount === 250 && m.data.payment.status === "created" && m.data.payment.by === u, m);
    const p1 = m.data.payment.id;
    m = await U.sd("pay.create", { option: "donate" });
    ok("an open-amount option needs the amount", !m.ok && m.error.code === "invalid", m.error);
    m = await U.sd("pay.create", { option: "donate", amount: 75 });
    ok("...and takes it from the payer", m.ok && m.data.payment.amount === 75, m);
    m = await U.sd("pay.create", { option: "fee", amount: 1 });
    ok("a fixed amount can't be overridden", m.ok && m.data.payment.amount === 250, m);
    m = await U.sd("pay.confirm", { id: p1, reference: "" });
    ok("a reference is required", !m.ok && m.error.code === "invalid", m.error);
    m = await U.sd("pay.confirm", { id: p1, reference: "WRONG" });
    ok("a reference the data source can't find leaves it submitted (not paid)", m.ok && m.data.payment.status === "submitted" && m.data.verified === false, m);
    m = await U.sd("pay.confirm", { id: p1, reference: "GOOD-REF" });
    ok("a reference it finds makes it paid", m.ok && m.data.payment.status === "paid" && m.data.payment.reference === "GOOD-REF", m);
    ok("...and the payer is told live", !!(await U.wait((x) => JSON.stringify(x).includes("payment_updated"), 2000)));
    m = await U.sd("pay.confirm", { id: p1, reference: "AGAIN" });
    ok("a paid payment can't be changed", !m.ok && m.error.code === "already_final", m.error);
    m = await U.sd("pay.cancel", { id: p1 });
    ok("...or cancelled", !m.ok && m.error.code === "already_final", m.error);
    m = await V.sd("pay.status", { id: p1 });
    ok("someone else can't see it", !m.ok && m.error.code === "not_found", m.error);
    m = await U.sd("pay.status", { id: p1 });
    ok("the payer can", m.ok && m.data.payment.status === "paid", m);
    m = await U.sd("pay.list");
    ok("payments are listed for their owner", m.ok && m.data.payments.length === 3, m.data);
    m = await U.sd("pay.list", { status: "paid" });
    ok("...filterable by status", m.data.payments.length === 1, m.data);

    t.section("Manual settlement and webhook");
    m = await U.sd("pay.create", { option: "fee_manual" });
    const p2 = m.data.payment.id;
    m = await U.sd("pay.confirm", { id: p2, reference: "UPI-9" });
    ok("with no verifying source, a reference leaves it submitted", m.ok && m.data.payment.status === "submitted", m);
    m = await U.sd("admin.pay.mark", { id: p2, status: "paid" });
    ok("only administrators mark payments", !m.ok && m.error.code === "forbidden", m.error);
    m = await A.sd("admin.pay.mark", { id: p2, status: "maybe" });
    ok("only paid or failed", !m.ok && m.error.code === "invalid", m.error);
    m = await A.sd("admin.pay.mark", { id: p2, status: "paid" });
    ok("an administrator marks it paid", m.ok && m.data.payment.status === "paid", m);
    m = await A.sd("admin.pay.mark", { id: p2, status: "failed" });
    ok("...and it can't be flipped afterwards", !m.ok && m.error.code === "already_final", m.error);
    const hook = (secret, body) => fetch(`${BASE}/api/sd/pay/webhook`, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    m = await U.sd("pay.create", { option: "fee_manual" });
    const p3 = m.data.payment.id;
    let r = await hook(null, { id: p3, status: "paid" });
    ok("the webhook needs the secret", r.status === 401, r);
    r = await hook("wrong-secret-1", { id: p3, status: "paid" });
    ok("a wrong secret is refused", r.status === 401, r);
    r = await hook(SECRET, { id: p3, status: "paid", reference: "BANK-77" });
    ok("the right secret settles the payment", r.status === 200 && r.body.data.payment.status === "paid" && r.body.data.payment.reference === "BANK-77", r);
    r = await hook(SECRET, { id: p3, status: "failed" });
    ok("a settled payment can't be changed by the webhook either", r.status !== 200, r);
    r = await hook(SECRET, { id: 999999, status: "paid" });
    ok("an unknown payment is not_found", r.status === 404, r);
    m = await U.sd("pay.create", { option: "fee_manual" });
    m = await U.sd("pay.cancel", { id: m.data.payment.id });
    ok("a payer can cancel one that isn't settled", m.ok && m.data.payment.status === "cancelled", m);

    for (const c of [A, U, V]) c.close();
    app.server.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
