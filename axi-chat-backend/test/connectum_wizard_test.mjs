// #wizard: definitions, conditional steps, every step type, approvals by role/designation, files, resuming.
import { suite, bootstrap, seedOrg, sfx, Client } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8100";
const t = suite("connectum_wizard", BASE);
const { ok } = t;

async function main() {
    const B = await bootstrap(BASE);
    const { A, connectUser, enroll } = B;
    const [pat, other, apr, apr2] = [`pat${sfx}`, `oth${sfx}`, `apr${sfx}`, `ap2${sfx}`];
    await seedOrg(A, [[pat, "Pat Ient", "Ops"], [other, "Oth Er", "Sales"], [apr, "Ann Approver", "Ops"], [apr2, "Bob Approver", "Ops"]]);
    await A.sd("admin.cfg.save", { kind: "roles", item: { name: "Registrar" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Manager" } });
    await A.sd("admin.user.update", { username: apr, roles: ["Registrar"], designation: "Manager" });
    await A.sd("admin.user.update", { username: apr2, roles: ["Registrar"] });
    await A.sd("admin.catalog.save", { kind: "service", name: "Consultation", price: 500 });
    await A.sd("admin.catalog.save", { kind: "service", name: "X-ray", price: 900 });
    const tok = {};
    const conn = async (n) => { tok[n] = await enroll(n); return new Client(BASE, n).connect(tok[n]); };
    const P = await conn(pat), O = await conn(other), R = await conn(apr), R2 = await conn(apr2);
    const tokenOf = tok[pat];
    const up = async (token, name, body) => (await (await fetch(`${BASE}/api/sd/files?name=${name}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf" }, body })).json());

    t.section("Defining a wizard");
    const steps = [
        { id: "details", type: "input", caption: "Your details", fields: [{ name: "full_name", type: "text", caption: "Name", required: true }, { name: "age", type: "wholenumber", caption: "Age" }] },
        { id: "howpay", type: "decision", caption: "How will you pay?", choices: ["Insured", "Cash"] },
        { id: "policy", type: "upload", caption: "Insurance card", accept: ["pdf", ".PNG"], condition: { field: "howpay", op: "eq", value: "Insured" } },
        { id: "svc", type: "list", caption: "Service", catalog: "service", multi: true },
        { id: "slot", type: "list", caption: "Slot", options: ["Morning", { value: "eve", label: "Evening" }] },
        { id: "review", type: "approval", caption: "Registrar review", approverRoles: ["registrar"], approverDesignations: ["manager"], message: "Please check the insurance card" },
        { id: "fee", type: "pay", caption: "Consultation fee", amount: 500, description: "Fee" },
        { id: "rules", type: "download", caption: "House rules", text: "No smoking." },
        { id: "done", type: "summary", caption: "Confirm" },
    ];
    let m = await A.sd("admin.wizard.save", { name: "register_patient", caption: "Register a patient", steps });
    ok("an administrator saves a wizard with every step type", m.ok && m.data.wizard.steps.length === 9, m);
    ok("roles and designations are stored in their canonical spelling", m.data.wizard.steps[5].approverRoles[0] === "Registrar" && m.data.wizard.steps[5].approverDesignations[0] === "Manager", m.data.wizard.steps[5]);
    const bad = async (what, patch, at = 0) => {
        const s2 = steps.map((x) => ({ ...x })); s2[at] = { ...s2[at], ...patch };
        const r = await A.sd("admin.wizard.save", { name: "badwiz", steps: s2 });
        ok(`${what} is refused`, !r.ok && r.error.code === "invalid", r.error);
    };
    await bad("a bad step type", { type: "magic" });
    await bad("a duplicate step id", { id: "details" }, 1);
    await bad("an input step with no fields", { fields: undefined });
    await bad("a decision with one choice", { choices: ["Only"] }, 1);
    await bad("a condition naming a later step", { condition: { field: "slot", op: "eq", value: "x" } }, 2);
    await bad("an approval with nobody named", { approverRoles: [], approverDesignations: [] }, 5);
    await bad("an approval by an unknown role", { approverRoles: ["Wizardry"] }, 5);
    await bad("a payment of zero", { amount: 0 }, 6);
    await bad("a list with nothing to list", { catalog: undefined }, 3);
    await bad("a download with neither file nor text", { text: "" }, 7);
    m = await A.sd("admin.wizard.save", { name: "1bad", steps });
    ok("a bad wizard name is refused", !m.ok, m.error);
    m = await A.sd("admin.wizard.save", { name: "w2", steps: [] });
    ok("a wizard needs steps", !m.ok, m.error);
    m = await P.sd("admin.wizard.save", { name: "sneaky", steps });
    ok("only administrators define wizards", !m.ok && m.error.code === "forbidden", m.error);
    await A.sd("admin.wizard.save", { name: "sales_only", caption: "Sales only", applicable: { departments: ["Sales"] }, steps: [{ id: "s", type: "summary" }] });
    m = await P.sd("wizard.list");
    ok("people see the wizards that apply to them", m.ok && m.data.wizards.some((w) => w.name === "register_patient") && !m.data.wizards.some((w) => w.name === "sales_only"), m.data);
    m = await O.sd("wizard.start", { name: "sales_only" });
    ok("...and can start those (Sales person)", m.ok, m);
    m = await P.sd("wizard.start", { name: "sales_only" });
    ok("...but not others", !m.ok && m.error.code === "not_found", m.error);

    t.section("Running it: input, decision, conditions");
    m = await P.sd("wizard.start", { name: "register_patient" });
    ok("starting shows the first step (a form with its fields)", m.ok && m.data.step.id === "details" && m.data.step.type === "input" && m.data.step.fields.length === 2 && m.data.step.number === 1 && m.data.step.of === 9, m);
    const runId = m.data.run.id;
    m = await P.sd("wizard.step", { runId, step: "howpay", value: "Cash" });
    ok("answering a step that isn't current is refused (stale)", !m.ok && m.error.code === "stale", m.error);
    m = await P.sd("wizard.step", { runId, step: "details", value: { age: 30 } });
    ok("a missing required answer is refused, naming the field", !m.ok && m.error.details?.fields?.full_name, m.error);
    m = await P.sd("wizard.step", { runId, step: "details", value: { full_name: "Pat Ient", age: "abc" } });
    ok("a wrongly typed answer is refused too", !m.ok && m.error.details?.fields?.age, m.error);
    m = await P.sd("wizard.step", { runId, step: "details", value: "text" });
    ok("a value of the wrong shape is refused", !m.ok && m.error.code === "invalid", m.error);
    m = await P.sd("wizard.step", { runId, step: "details", value: { full_name: "Pat Ient", age: 30 } });
    ok("a good answer moves on to the decision", m.ok && m.data.step.id === "howpay" && m.data.step.choices.join() === "Insured,Cash", m);
    m = await P.sd("wizard.step", { runId, step: "howpay", value: "Barter" });
    ok("a choice that isn't offered is refused", !m.ok, m.error);
    m = await P.sd("wizard.step", { runId, step: "howpay", value: "Insured" });
    ok("choosing Insured leads to the upload step (its condition holds)", m.ok && m.data.step.id === "policy" && m.data.step.accept.join() === "pdf,png", m);

    t.section("Upload");
    m = await P.sd("wizard.step", { runId, step: "policy", value: "nosuchfile" });
    ok("an unknown file is refused", !m.ok, m.error);
    let f = await up(tokenOf, "card.exe", "MZ..");
    m = await P.sd("wizard.step", { runId, step: "policy", value: f.data.file.id });
    ok("a file type that isn't accepted is refused", !m.ok && /pdf/.test(m.error.message), m.error);
    const fo = await up(tok[other], "theirs.pdf", "%PDF-1");
    m = await P.sd("wizard.step", { runId, step: "policy", value: fo.data.file.id });
    ok("someone else's file is refused", !m.ok && m.error.code === "forbidden", m.error);
    f = await up(tokenOf, "card.pdf", "%PDF-1.4 card");
    ok("the upload itself worked", f.ok && f.data.file.id, f);
    m = await P.sd("wizard.step", { runId, step: "policy", value: f.data.file.id });
    ok("a good file moves on to the list step (catalog services, several allowed)", m.ok && m.data.step.id === "svc" && m.data.step.multi === true && m.data.step.options.length === 2, m);

    t.section("Lists");
    const optIds = m.data.step.options.map((o) => o.value);
    m = await P.sd("wizard.step", { runId, step: "svc", value: [] });
    ok("an empty pick is refused", !m.ok, m.error);
    m = await P.sd("wizard.step", { runId, step: "svc", value: ["nope"] });
    ok("something that isn't an option is refused", !m.ok, m.error);
    m = await P.sd("wizard.step", { runId, step: "svc", value: [optIds[0], optIds[0]] });
    ok("the same pick twice is refused", !m.ok, m.error);
    m = await P.sd("wizard.step", { runId, step: "svc", value: "not-a-list" });
    ok("a multi list needs a list", !m.ok, m.error);
    m = await P.sd("wizard.step", { runId, step: "svc", value: optIds });
    ok("picking several works; then a static list with labels", m.ok && m.data.step.id === "slot" && m.data.step.options[1].label === "Evening", m);
    m = await P.sd("wizard.step", { runId, step: "slot", value: "eve" });

    t.section("Approval by role + designation");
    ok("an approval step waits", m.ok && m.data.step.id === "review" && m.data.step.waiting === true && m.data.run.status === "waiting", m.data);
    m = await P.sd("wizard.step", { runId, step: "review", value: "x" });
    ok("the person can't answer it themselves", !m.ok && m.error.code === "waiting", m.error);
    m = await P.sd("wizard.current", { runId });
    ok("wizard.current still shows the waiting step (resumable)", m.ok && m.data.step.waiting === true, m.data);
    m = await R2.sd("req.list", {});
    ok("someone with the role but not the designation is NOT asked (both are needed)", m.ok && !JSON.stringify(m.data).includes("register_patient") && !JSON.stringify(m.data).includes("Register a patient"), m.data);
    m = await R.sd("req.list", {});
    const req = (m.data.requests || m.data.items || []).find((x) => x.type === "wizard");
    ok("the approver has a request naming the wizard", !!req && /Register a patient/.test(req.data.wizard), m.data);
    m = await R.sd("wizard.run", { runId });
    ok("the approver can look at the answers", m.ok && m.data.run.answers.details.full_name === "Pat Ient" && m.data.run.by === pat, m);
    m = await R2.sd("wizard.run", { runId });
    ok("someone who isn't the owner or an approver can't", !m.ok && m.error.code === "not_found", m.error);
    let dl = await fetch(`${BASE}/api/sd/files/${f.data.file.id}`, { headers: { authorization: `Bearer ${tok[apr]}` } });
    ok("the approver can open the uploaded file", dl.status === 200 && (await dl.text()).startsWith("%PDF"), dl.status);
    dl = await fetch(`${BASE}/api/sd/files/${f.data.file.id}`, { headers: { authorization: `Bearer ${tok[apr2]}` } });
    ok("...another person can't", dl.status === 403 || dl.status === 404, dl.status);
    m = await R.sd("req.respond", { id: req.id, action: "accept" });
    ok("the approver accepts", m.ok, m);
    m = await P.wait((x) => x.type === "sd_event" || x.event === "wizard_updated" || JSON.stringify(x).includes("wizard_updated"), 3000);
    ok("the owner is told live", !!m, "no wizard_updated event");
    m = await P.sd("wizard.current", { runId });
    ok("the run moved on to payment", m.ok && m.data.step.id === "fee" && m.data.run.status === "running" && m.data.step.amount === 500, m.data);

    t.section("Pay, download, summary");
    m = await P.sd("wizard.step", { runId, step: "fee", value: {} });
    ok("a payment needs a reference", !m.ok, m.error);
    m = await P.sd("wizard.step", { runId, step: "fee", value: { reference: "UPI-123" } });
    ok("with a reference it moves on (unverified: no checking source set)", m.ok && m.data.step.id === "rules" && m.data.run.answers.fee.verified === false, m.data);
    m = await P.sd("wizard.step", { runId, step: "rules" });
    ok("a download step is acknowledged", m.ok && m.data.step.id === "done" && m.data.step.answers.details.age === 30, m.data);
    m = await P.sd("wizard.step", { runId, step: "done", value: { confirm: true } });
    ok("confirming the summary finishes the run", m.ok && m.data.run.status === "done" && m.data.step === null && m.data.run.finishedTs, m.data);
    m = await P.sd("wizard.step", { runId, step: "done" });
    ok("a finished run takes no more answers", !m.ok && m.error.code === "already_finished", m.error);
    m = await P.sd("wizard.runs");
    ok("runs are listed for their owner", m.ok && m.data.runs.some((r) => r.id === runId && r.status === "done"), m.data);
    m = await O.sd("wizard.current", { runId });
    ok("other people can't open my run", !m.ok && m.error.code === "not_found", m.error);

    t.section("Skipped steps, rejection, cancelling");
    m = await P.sd("wizard.start", { name: "register_patient" });
    const r2 = m.data.run.id;
    await P.sd("wizard.step", { runId: r2, step: "details", value: { full_name: "P2" } });
    m = await P.sd("wizard.step", { runId: r2, step: "howpay", value: "Cash" });
    ok("choosing Cash skips the upload step", m.ok && m.data.step.id === "svc", m.data);
    await P.sd("wizard.step", { runId: r2, step: "svc", value: [optIds[0]] });
    m = await P.sd("wizard.step", { runId: r2, step: "slot", value: "Morning" });
    ok("waiting for approval again", m.data.run.status === "waiting", m.data);
    m = await R.sd("req.list", {});
    const req2 = (m.data.requests || m.data.items || []).find((x) => x.type === "wizard" && x.status === "pending");
    m = await R.sd("req.respond", { id: req2.id, action: "reject" });
    ok("a rejection ends the run as rejected", m.ok && (await P.sd("wizard.current", { runId: r2 })).data.run.status === "rejected", m);
    m = await P.sd("wizard.start", { name: "register_patient" });
    const r3 = m.data.run.id;
    m = await P.sd("wizard.cancel", { runId: r3 });
    ok("a person can cancel their own run", m.ok && m.data.run.status === "cancelled", m);
    m = await P.sd("wizard.cancel", { runId: r3 });
    ok("...once", !m.ok && m.error.code === "already_finished", m.error);
    m = await O.sd("wizard.cancel", { runId: r2 });
    ok("...and not other people's", !m.ok && m.error.code === "not_found", m.error);
    m = await A.sd("admin.wizard.delete", { name: "sales_only" });
    ok("an administrator deletes a wizard", m.ok, m);
    for (const c of [A, P, O, R, R2]) c.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
