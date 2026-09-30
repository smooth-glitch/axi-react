// A person's details (address, gender, date of birth, education, skills), user roles, and options that depend on
// roles and on conditions over global variables.
//
//   redis-cli -n 17 FLUSHDB    (run_all starts Redis with 64 databases)
//   REDIS_DB=17 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=1000 erl ... -s chat_app start 5575 8095
//   node test/connectum_people_test.mjs http://localhost:8095
//
// Also run by `node test/run_all.mjs connectum_people`.

import { suite, bootstrap, seedOrg, sfx, api } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8095";
const t = suite("connectum_people", BASE);
const { ok } = t;

async function main() {
    console.log(`People, roles and conditional options against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const { A, connectUser, http } = B;
    const [amy, raj, eve] = [`amy${sfx}`, `raj${sfx}`, `eve${sfx}`];
    await seedOrg(A, [[amy, "Amy Ops", "Ops"], [raj, "Raj Sales", "Sales"], [eve, "Eve Ops", "Ops"]]);
    const Amy = await connectUser(amy), Raj = await connectUser(raj), Eve = await connectUser(eve);

    t.section("Person details: address, gender, date of birth, education, skills");
    let m = await Amy.sd("profile.get");
    ok("a new person starts with empty details", m.ok && m.data.profile.gender === null && m.data.profile.dob === null && m.data.profile.address === null &&
        Array.isArray(m.data.profile.skills) && m.data.profile.skills.length === 0 && m.data.profile.education === null, m.data);
    m = await Amy.sd("profile.update", {
        address: "12 MG Road, Pune", gender: "Female", dob: "1994-04-23", education: "B.Tech Computer Science", skills: ["Erlang", " react ", "erlang", "", "SQL"],
    });
    ok("a person can fill in their own details", m.ok, m);
    const p = m.data.profile;
    ok("gender is normalised", p.gender === "female", p.gender);
    ok("skills are trimmed, de-duplicated (any case) and blanks dropped", JSON.stringify(p.skills) === JSON.stringify(["Erlang", "react", "SQL"]), p.skills);
    ok("address, date of birth and education are stored", p.address === "12 MG Road, Pune" && p.dob === "1994-04-23" && p.education === "B.Tech Computer Science", p);
    ok("the change is kept (profile.get shows it)", (await Amy.sd("profile.get")).data.profile.dob === "1994-04-23");
    m = await Amy.sd("profile.update", { skills: "go, rust,  , go" });
    ok("skills can also be comma separated text", m.ok && JSON.stringify(m.data.profile.skills) === JSON.stringify(["go", "rust"]), m.data);
    m = await Amy.sd("profile.update", { gender: "prefer not to say" });
    ok("'prefer not to say' is accepted", m.ok && m.data.profile.gender === "prefer_not_to_say", m);
    m = await Amy.sd("profile.update", { gender: null, dob: null, address: null });
    ok("details can be cleared", m.ok && m.data.profile.gender === null && m.data.profile.dob === null && m.data.profile.address === null, m);
    ok("...clearing one thing keeps the others", m.data.profile.education === "B.Tech Computer Science" && m.data.profile.skills.length === 2, m.data.profile);
    m = await Amy.sd("profile.update", { city: "Pune", country: "India", pin: "411001" });
    ok("city, country and pin can be changed the same way", m.ok && m.data.profile.city === "Pune", m);

    t.section("Person details: checks");
    for (const [what, args] of [
        ["an unknown gender", { gender: "robot" }],
        ["a date of birth in the wrong format", { dob: "23/04/1994" }],
        ["an impossible date (30 Feb)", { dob: "1994-02-30" }],
        ["a date of birth in the future", { dob: "2999-01-01" }],
        ["a date before 1900", { dob: "1850-01-01" }],
        ["a number as the date", { dob: 19940423 }],
        ["an over-long address", { address: "x".repeat(300) }],
        ["an over-long education", { education: "x".repeat(200) }],
        ["a skill longer than 40 characters", { skills: ["y".repeat(41)] }],
        ["more than 30 skills", { skills: Array.from({ length: 31 }, (_, i) => `skill${i}`) }],
        ["skills that aren't text", { skills: [1, 2] }],
        ["address that isn't text", { address: { street: "x" } }],
    ]) {
        m = await Amy.sd("profile.update", args);
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    m = await Amy.sd("profile.update", {});
    ok("an empty update is refused with a hint", !m.ok && /Nothing to change/.test(m.error.message), m.error);
    m = await Amy.sd("profile.update", { name: "Hacked", roles: ["x"], isHost: true, role: "admin", email: "x@y.z" });
    ok("only the person fields can be changed here (name, roles, isHost, role, email are ignored)", !m.ok && /Nothing to change/.test(m.error.message), m);
    const after = (await Amy.sd("profile.get")).data.profile;
    ok("...and the record is untouched", after.name === "Amy Ops" && after.role === "user" && after.isHost === false, { n: after.name, r: after.role });
    m = await Amy.sd("profile.update", { address: "ctrl\u0000char\nhere" });
    ok("control characters are stripped from text", m.ok && m.data.profile.address === "ctrlcharhere", m);

    t.section("Privacy: other people never see these");
    const pub = await Raj.sd("users.search", { q: amy });
    ok("search results carry only public fields", pub.ok && pub.data.users.length >= 1 &&
        pub.data.users.every((u) => !("dob" in u) && !("gender" in u) && !("address" in u) && !("education" in u) && !("skills" in u) && !("email" in u)), pub.data?.users?.[0]);
    const aList = (await A.sd("admin.user.get", { username: amy }));
    ok("an administrator can see them", aList.ok && aList.data.user.education === "B.Tech Computer Science", aList.data);

    t.section("Administrators can set details for someone else");
    m = await A.sd("admin.user.update", { username: raj, gender: "male", dob: "1990-01-15", skills: ["sales"], education: "MBA" });
    ok("admin.user.update accepts the person fields", m.ok && m.data.user.gender === "male" && m.data.user.dob === "1990-01-15" && m.data.user.skills[0] === "sales", m);
    m = await A.sd("admin.user.update", { username: raj, dob: "nope" });
    ok("...with the same checks", !m.ok && m.error.code === "invalid", m.error);
    m = await A.sd("users.invite", { name: "Ina Invited", username: `ina${sfx}`, email: `ina${sfx}@test.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst",
        gender: "female", dob: "1999-09-09", skills: "qa, testing", education: "BSc", address: "Somewhere 1" });
    ok("an invitation can carry the details too", m.ok && m.data.user.gender === "female" && m.data.user.skills.length === 2, m);

    t.section("Self-registration collects them too");
    const reg = await http.post("/api/sd/register", { name: "Reg Person", username: `regp${sfx}`, email: `regp${sfx}@test.co`, mobile: `+9198780${String(Date.now()).slice(-5)}`, password: "Str0ngPass99x",
        category: "Patient", country: "India", city: "Pune", pin: "411001", gender: "other", dob: "1985-05-05", education: "MA", skills: ["yoga"], address: "Lake View 4" });
    ok("a person signing up can give gender, date of birth, education, skills and address", reg.status === 200 && reg.data?.registered === true, reg.json);
    const regUser = (await A.sd("admin.user.get", { username: `regp${sfx}` })).data.user;
    ok("they are all saved on the new (pending) account", regUser.gender === "other" && regUser.dob === "1985-05-05" && regUser.skills[0] === "yoga" && regUser.address === "Lake View 4", regUser);
    const bad = await http.post("/api/sd/register", { name: "Bad Dob", username: `badd${sfx}`, email: `badd${sfx}@test.co`, mobile: `+9198781${String(Date.now()).slice(-5)}`, password: "Str0ngPass99x",
        category: "Patient", country: "India", city: "Pune", pin: "411001", dob: "31-12-1990" });
    ok("a bad date of birth stops the registration", bad.error?.code === "invalid", bad.json);

    t.section("Roles");
    m = await A.sd("admin.cfg.save", { kind: "roles", item: { name: "HR Manager", description: "Runs HR" } });
    ok("an administrator can create a role", m.ok && m.data.item.name === "HR Manager", m);
    await A.sd("admin.cfg.save", { kind: "roles", item: { name: "Approver" } });
    m = await A.sd("admin.cfg.list", { kind: "roles" });
    ok("roles are listed", m.ok && m.data.items.map((r) => r.name).sort().join() === "Approver,HR Manager", m.data);
    m = await A.sd("admin.cfg.save", { kind: "roles", item: { name: "" } });
    ok("a role needs a name", !m.ok && m.error.code === "invalid", m.error);
    m = await A.sd("admin.cfg.save", { kind: "roles", item: { name: "x".repeat(80) } });
    ok("a very long role name is refused", !m.ok, m.error);
    m = await Amy.sd("admin.cfg.save", { kind: "roles", item: { name: "Sneaky" } });
    ok("an ordinary user can't create roles", !m.ok && m.error.code === "forbidden", m.error);

    m = await A.sd("admin.user.update", { username: amy, roles: ["hr manager"] });
    ok("an administrator can give an employee a role (any letter case)", m.ok && JSON.stringify(m.data.user.roles) === JSON.stringify(["HR Manager"]), m);
    m = await A.sd("admin.user.update", { username: amy, roles: ["HR Manager", "approver", "Approver"] });
    ok("several roles, de-duplicated, stored under their proper names", m.ok && JSON.stringify(m.data.user.roles) === JSON.stringify(["HR Manager", "Approver"]), m.data.user.roles);
    m = await A.sd("admin.user.update", { username: amy, roles: ["Nonexistent"] });
    ok("an unknown role is refused", !m.ok && /Unknown role/.test(m.error.message), m.error);
    m = await A.sd("admin.user.update", { username: amy, roles: "HR Manager" });
    ok("roles must be a list", !m.ok, m.error);
    ok("the person can see their own roles", JSON.stringify((await Amy.sd("profile.get")).data.profile.roles) === JSON.stringify(["HR Manager", "Approver"]));
    m = await Amy.sd("profile.update", { roles: ["Approver"] });
    ok("people can't give themselves roles", !m.ok, m);
    m = await A.sd("admin.cfg.delete", { kind: "roles", name: "HR Manager" });
    ok("a role that someone has can't be deleted", !m.ok && m.error.code === "in_use", m.error);
    m = await A.sd("admin.user.update", { username: raj, roles: [] });
    ok("clearing roles works", m.ok && m.data.user.roles.length === 0, m);
    const selfRegRoles = await http.post("/api/sd/register", { name: "Grabby", username: `grab${sfx}`, email: `grab${sfx}@test.co`, mobile: `+9198782${String(Date.now()).slice(-5)}`, password: "Str0ngPass99x",
        category: "Patient", country: "India", city: "Pune", pin: "411001", roles: ["HR Manager"] });
    const grabby = (await A.sd("admin.user.get", { username: `grab${sfx}` })).data?.user;
    ok("someone registering themselves cannot pick roles (ignored)", selfRegRoles.status === 200 && grabby && grabby.roles.length === 0, grabby?.roles);
    m = await A.sd("users.invite", { name: "Ivy Invited", username: `ivy${sfx}`, email: `ivy${sfx}@test.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst", roles: ["Approver"] });
    ok("an administrator can invite someone straight into a role", m.ok && m.data.user.roles[0] === "Approver", m);
    m = await A.sd("admin.user.update", { username: `regp${sfx}`, roles: ["Approver"] });
    ok("roles are for employees only (an outside person can't have one)", !m.ok && /only to employees/.test(m.error.message), m.error);

    t.section("Options for a role");
    m = await A.sd("admin.tstruct.save", { name: "leave_form", caption: "Leave", fields: [{ name: "why", type: "text", caption: "Why" }] });
    const opt = async (o) => { const r = await A.sd("admin.option.save", o); if (!r.ok) console.log("   option failed:", o.id, JSON.stringify(r.error)); return r; };
    await opt({ id: "for_all", caption: "Everyone's option", type: "data_input", target: "leave_form" });
    m = await opt({ id: "for_hr", caption: "HR only", type: "data_input", target: "leave_form", applicable: { roles: ["HR Manager"] } });
    ok("an option can be limited to a role", m.ok && m.data.option.applicable.roles[0] === "HR Manager", m);
    await opt({ id: "for_hr_ops", caption: "HR people in Ops", type: "data_input", target: "leave_form", applicable: { roles: ["HR Manager"], departments: ["Ops"] } });
    await opt({ id: "for_two", caption: "Approver or HR", type: "download", applicable: { roles: ["Approver", "HR Manager"] } });
    m = await opt({ id: "bad_role", caption: "x", type: "data_input", target: "leave_form", applicable: { roles: ["Nope"] } });
    ok("an unknown role in the rules is refused", !m.ok && /unknown value/.test(m.error.message), m.error);
    const ids = async (c) => (await c.sd("options.list")).data.options.map((o) => o.id).sort();
    ok("the person with the role sees the role's options", JSON.stringify(await ids(Amy)) === JSON.stringify(["for_all", "for_hr", "for_hr_ops", "for_two"]), await ids(Amy));
    ok("a person without it does not (Raj, Sales, no roles)", JSON.stringify(await ids(Raj)) === JSON.stringify(["for_all"]), await ids(Raj));
    ok("...department rules and role rules combine (Eve is Ops but has no role)", JSON.stringify(await ids(Eve)) === JSON.stringify(["for_all"]), await ids(Eve));
    await A.sd("admin.user.update", { username: eve, roles: ["Approver"] });
    ok("giving Eve the Approver role shows her the option for Approvers", JSON.stringify(await ids(Eve)) === JSON.stringify(["for_all", "for_two"]), await ids(Eve));
    await A.sd("admin.user.update", { username: raj, roles: ["HR Manager"] });
    ok("Raj (Sales) gets HR's option but not the Ops-only one", JSON.stringify(await ids(Raj)) === JSON.stringify(["for_all", "for_hr", "for_two"]), await ids(Raj));
    const cats = (await Raj.sd("options.categories")).data;
    ok("the category pills and counts follow the roles too", cats.categories.find((c) => c.id === "data_input").count === 2 && cats.total === 3, cats);
    m = await Amy.sd("option.user.save", { id: `mine${sfx}`, caption: "Mine", type: "upload", applicable: { roles: ["Nope"] } });
    ok("a person's own option is checked the same way", !m.ok, m.error);

    t.section("Options that depend on a condition (global variables)");
    m = await opt({ id: "pune_only", caption: "Pune office", type: "data_input", target: "leave_form", condition: { field: "city", op: "eq", value: "Pune" } });
    ok("an option can carry a condition over global variables", m.ok && m.data.option.condition.field === "city", m);
    await A.sd("admin.user.update", { username: amy, city: "Pune", country: "India", pin: "411001" });
    await A.sd("admin.user.update", { username: raj, city: "Mumbai", country: "India", pin: "400001" });
    ok("it shows for someone in Pune", (await ids(Amy)).includes("pune_only"));
    ok("...and not for someone in Mumbai", !(await ids(Raj)).includes("pune_only"));
    await A.sd("admin.user.update", { username: raj, city: "Pune", country: "India", pin: "411001" });
    ok("changing the person's city changes what they see, at once", (await ids(Raj)).includes("pune_only"));
    await opt({ id: "combo", caption: "Pune hosts or Delhi", type: "data_input", target: "leave_form",
        condition: { any: [{ all: [{ field: "city", op: "eq", value: "Pune" }, { field: "department", op: "eq", value: "Ops" }] }, { field: "city", op: "eq", value: "Delhi" }] } });
    ok("all / any can be nested (Pune AND Ops, or Delhi)", (await ids(Amy)).includes("combo") && !(await ids(Raj)).includes("combo"), { amy: await ids(Amy), raj: await ids(Raj) });
    await opt({ id: "userin", caption: "Named users", type: "data_input", target: "leave_form", condition: { field: "username", op: "in", value: [amy, eve] } });
    ok("'in' works with a list", (await ids(Amy)).includes("userin") && !(await ids(Raj)).includes("userin"));
    await opt({ id: "notempty", caption: "Has a pin", type: "data_input", target: "leave_form", condition: { field: "pin", op: "notempty" } });
    ok("'notempty' works", (await ids(Amy)).includes("notempty"));
    await opt({ id: "isho", caption: "Hosts only", type: "data_input", target: "leave_form", condition: { field: "isHost", op: "eq", value: true } });
    ok("true/false variables work (nobody is a host here)", !(await ids(Amy)).includes("isho"));
    await opt({ id: "and_role", caption: "Role AND condition", type: "data_input", target: "leave_form", applicable: { roles: ["HR Manager"] }, condition: { field: "city", op: "eq", value: "Pune" } });
    ok("the rules and the condition must BOTH hold", (await ids(Amy)).includes("and_role") && (await ids(Raj)).includes("and_role") && !(await ids(Eve)).includes("and_role"), await ids(Eve));

    m = await opt({ id: "bad1", caption: "x", type: "data_input", target: "leave_form", condition: { field: "nonsense", op: "eq", value: 1 } });
    ok("an unknown variable in a condition is refused (catches typos)", !m.ok && /unknown variable: nonsense/.test(m.error.message), m.error);
    m = await opt({ id: "bad2", caption: "x", type: "data_input", target: "leave_form", condition: { field: "city", op: "sounds_like", value: "x" } });
    ok("an unknown operator is refused", !m.ok && /malformed/.test(m.error.message), m.error);
    m = await opt({ id: "bad3", caption: "x", type: "data_input", target: "leave_form", condition: "city = Pune" });
    ok("a condition must be an object", !m.ok, m.error);
    m = await opt({ id: "bad4", caption: "x", type: "data_input", target: "leave_form", condition: { field: "city", op: "in", value: "Pune" } });
    ok("'in' needs a list", !m.ok, m.error);
    m = await opt({ id: "bad5", caption: "x", type: "data_input", target: "leave_form", condition: { all: Array.from({ length: 60 }, () => ({ field: "city", op: "eq", value: "x" })) } });
    ok("a huge condition is refused", !m.ok, m.error);
    m = await opt({ id: "ok_null", caption: "null cond", type: "data_input", target: "leave_form", condition: null });
    ok("condition: null means always", m.ok && m.data.option.condition === null, m);
    const legacy = await A.sd("admin.option.list");
    ok("options saved before conditions existed still work (no condition = always)", (await ids(Amy)).includes("for_all") && legacy.ok);

    for (const c of [Amy, Raj, Eve, A]) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
