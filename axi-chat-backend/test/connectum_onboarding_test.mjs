// Onboarding process per user category.
import { suite, bootstrap, seedOrg, sfx } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8099";
const t = suite("connectum_onboarding", BASE);
const { ok } = t;
let n = 0;
const reg = (http, o) => { n++; const id = `${sfx}${n}`; return http.post("/api/sd/register", { name: `Person ${id}`, username: `pr${id}`, email: `pr${id}@test.co`, mobile: `+9198${String(70000000 + n * 137 + (Date.now() % 1000))}`, password: "Str0ngPass99x", country: "India", city: "Pune", pin: "411001", ...o }); };

async function main() {
    const { A, http, connectUser } = await bootstrap(BASE);
    const [rev, boss] = [`rev${sfx}`, `bos${sfx}`];
    await seedOrg(A, [[rev, "Reviewer", "Ops"], [boss, "Boss", "Ops"]]);
    await A.sd("admin.cfg.save", { kind: "roles", item: { name: "Registrar" } });
    await A.sd("admin.user.update", { username: rev, roles: ["Registrar"] });
    const Rev = await connectUser(rev);

    t.section("Default: nothing changes");
    let m = await A.sd("admin.onboarding.list");
    ok("every category is listed with the default process", m.ok && m.data.processes.length >= 5 && m.data.processes.every((p) => p.requireApproval === true && p.custom === false), m.data);
    let r = await reg(http, { category: "Patient" });
    ok("registering with no policy still waits for approval", r.data?.status === "pending" && r.data.awaitingApprovalFrom >= 1, r);

    t.section("Defining a process");
    m = await A.sd("admin.onboarding.save", { category: "patient", requireApproval: true, approverRoles: ["registrar"], requiredFields: ["dob", "Address"], welcome: "Welcome to the clinic" });
    ok("an administrator sets a process (names are matched loosely and stored canonically)", m.ok && m.data.process.category === "Patient" && m.data.process.approverRoles[0] === "Registrar" && m.data.process.requiredFields.join() === "address,dob" && m.data.process.custom === true, m);
    for (const [what, o] of [["an unknown category", { category: "Alien" }], ["an unknown role", { category: "Patient", approverRoles: ["Nobody"] }], ["an unknown field", { category: "Patient", requiredFields: ["shoe_size"] }], ["roles with no approval", { category: "Vendor", requireApproval: false, approverRoles: ["Registrar"] }], ["a text requireApproval", { category: "Patient", requireApproval: "no" }], ["no category", {}]]) {
        m = await A.sd("admin.onboarding.save", o);
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    m = await Rev.sd("admin.onboarding.save", { category: "Patient" });
    ok("only administrators", !m.ok && m.error.code === "forbidden", m.error);
    m = await http.get("/api/sd/public");
    ok("the public organisation info tells the form what each category needs", m.data.onboarding?.Patient?.requiredFields?.join() === "address,dob" && m.data.onboarding.Patient.welcome === "Welcome to the clinic", m.data.onboarding?.Patient);
    ok("...and nothing else leaks (no role names)", !JSON.stringify(m.data.onboarding).includes("Registrar"));

    t.section("Registering under it");
    r = await reg(http, { category: "Patient" });
    ok("missing required details are refused, naming them", r.status === 400 || r.data?.error?.code === "invalid", r);
    ok("...the message says which", /address, dob/.test(JSON.stringify(r)), r);
    r = await reg(http, { category: "Patient", dob: "1990-01-01", address: "1 Road" });
    ok("with the details it registers, pending", r.data?.status === "pending" && r.data.welcome === "Welcome to the clinic", r);
    const reqId = r.data.requestId, uname = r.data.username;
    ok("only the role holder is asked to approve (1 approver)", r.data.awaitingApprovalFrom === 1, r.data);
    m = await Rev.sd("req.list");
    ok("the reviewer sees the request", m.ok && JSON.stringify(m.data).includes(uname), m);
    m = await Rev.sd("req.respond", { id: reqId, action: "accept" });
    ok("the role holder (not a host) can approve", m.ok, m);
    m = await A.sd("admin.user.get", { username: uname });
    ok("the person is active afterwards, with no host link (approver isn't a host)", m.ok && m.data.user.status === "active" && !m.data.user.host, m.data?.user);
    r = await reg(http, { category: "Customer" });
    ok("other categories are unaffected", r.data?.status === "pending", r);

    t.section("Automatic approval");
    await A.sd("admin.onboarding.save", { category: "Citizen", requireApproval: false, welcome: "You're in" });
    r = await reg(http, { category: "Citizen" });
    ok("a category that needs no approval is active at once, with no request", r.data?.status === "active" && r.data.requestId === null && r.data.awaitingApprovalFrom === 0 && r.data.welcome === "You're in", r);
    m = await A.sd("admin.user.get", { username: r.data.username });
    ok("the account really is active", m.ok && m.data.user.status === "active", m.data?.user);

    t.section("Falling back");
    await A.sd("admin.cfg.save", { kind: "roles", item: { name: "Ghostrole" } });
    await A.sd("admin.onboarding.save", { category: "Vendor", approverRoles: ["Ghostrole"] });
    r = await reg(http, { category: "Vendor" });
    ok("if nobody holds the approver role, the usual approvers are used", r.data?.status === "pending" && r.data.awaitingApprovalFrom >= 1, r);
    m = await A.sd("admin.onboarding.delete", { category: "Vendor" });
    ok("a process can be removed (back to default)", m.ok && (await A.sd("onboarding.get", { category: "Vendor" })).data.process.custom === false, m);
    m = await A.sd("admin.onboarding.delete", { category: "Vendor" });
    ok("removing it again is not_found", !m.ok && m.error.code === "not_found", m.error);
    m = await Rev.sd("onboarding.get", { category: "Patient" });
    ok("anyone can read a category's process", m.ok && m.data.process.requiredFields.length === 2, m);
    for (const c of [A, Rev]) c.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
