// Enterprise profile (location, contact person), the full list of user categories, and Connectum codes:
// every enterprise and person has a unique code (shown as a QR); people connect by scanning or typing it.
//
//   redis-cli -n 3 FLUSHDB
//   REDIS_DB=3 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=1000 \
//   SANDESH_PUBLIC_URL=https://ent.example erl ... -s chat_app start 5572 8092
//   node test/connectum_codes_test.mjs http://localhost:8092
//
// Also run by `node test/run_all.mjs connectum_codes`.

import { suite, bootstrap, seedOrg, sleep, sfx, api } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8092";
const t = suite("connectum_codes", BASE);
const { ok } = t;

async function main() {
    console.log(`Connectum codes + enterprise profile against ${BASE}\n`);

    t.section("Enterprise sign-up: location and contact person");
    const http = api(BASE);
    let r = await http.post("/api/sd/setup/start", { org: "Loc Co", name: "X", username: "x1", email: "x1@t.co", mobile: "+919886000001", location: "not-an-object" });
    ok("setup rejects a location that isn't an object", r.status >= 400 && r.error?.code === "invalid", r.json);
    r = await http.post("/api/sd/setup/start", { org: "Loc Co", name: "X", username: "x1", email: "x1@t.co", mobile: "+919886000001", location: { address: "a".repeat(300) } });
    ok("setup rejects an over-long address", r.error?.code === "invalid" && /too long/.test(r.error?.message ?? ""), r.json);
    r = await http.post("/api/sd/setup/start", { org: "Loc Co", name: "X", username: "x1", email: "x1@t.co", mobile: "+919886000001", contact: { email: "nope" } });
    ok("setup rejects a bad contact email", r.error?.code === "invalid", r.json);

    const B = await bootstrap(BASE, {
        org: "Pune Hospital",
        setupExtra: {
            location: { address: "12 MG Road", country: "India", city: "Pune", pin: "411001", pin: "411001" },
            contact: { name: "Dr. Rao", email: "rao@hospital.test", mobile: "+919886000002" },
        },
    });
    if (B.failed) { ok("first-run setup with location + contact works", false, B.failed.json); t.done(); }
    const { A, connectUser } = B;
    ok("first-run setup with location + contact works", true);

    {
        const org = (await A.sd("admin.org.get")).data.org;
        ok("the location was saved", org.location?.city === "Pune" && org.location?.address === "12 MG Road" && org.location?.pin === "411001", org.location);
        ok("the contact person was saved", org.contact?.name === "Dr. Rao" && org.contact?.email === "rao@hospital.test", org.contact);
        ok("the enterprise has a Connectum code from the start", /^[0-9A-Z]{8}$/.test(org.code ?? ""), org.code);
    }

    let m = await A.sd("admin.org.set", { location: { city: "Mumbai", country: "India" } });
    ok("admin can change the location", m.ok && m.data.org.location.city === "Mumbai" && m.data.org.name === "Pune Hospital", m);
    m = await A.sd("admin.org.set", { name: "Pune Hospital Ltd" });
    ok("the old call (just a name) still works and keeps the location", m.ok && m.data.org.name === "Pune Hospital Ltd" && m.data.org.location.city === "Mumbai", m);
    m = await A.sd("admin.org.set", { contact: { name: "Nurse Joy", email: "joy@hospital.test" } });
    ok("admin can change the contact person", m.ok && m.data.org.contact.name === "Nurse Joy", m);
    m = await A.sd("admin.org.set", {});
    ok("changing nothing is refused", !m.ok && m.error.code === "invalid", m);
    m = await A.sd("admin.org.set", { location: { pin: "x".repeat(40) } });
    ok("an over-long pin is refused", !m.ok && m.error.code === "invalid", m);
    m = await A.sd("admin.org.set", { name: "" });
    ok("an empty name is refused", !m.ok, m);
    const pub = await http.get("/api/sd/public");
    ok("the public page shows only city and country of the location", pub.data.location?.city === "Mumbai" && !("address" in (pub.data.location ?? {})) && !("pin" in (pub.data.location ?? {})), pub.data.location);

    t.section("User categories: the spec's full list");
    m = await A.sd("admin.cfg.list", { kind: "categories" });
    const names = m.data.items.map((c) => c.name);
    const spec = ["Customer", "Vendor", "Service provider", "Consultant", "Shareholder", "Patient", "Student", "Contract employee", "Gig worker", "Freelancer", "Citizen", "Candidate"];
    ok("every category from the spec is available", spec.every((c) => names.includes(c)), spec.filter((c) => !names.includes(c)));
    ok("the categories that were already there are kept", ["Doctor", "Professional"].every((c) => names.includes(c)), names);
    m = await A.sd("admin.cfg.save", { kind: "categories", item: { name: "Volunteer" } });
    ok("admins can still add their own category", m.ok, m);
    m = await A.sd("admin.cfg.save", { kind: "categories", item: { name: "Gig worker", active: false } });
    ok("a category can be switched off", m.ok, m);
    ok("the public list drops a switched-off category", !(await http.get("/api/sd/public")).data.categories.includes("Gig worker"));

    await seedOrg(A, [[`dora${sfx}`, "Dora Ops", "Ops"], [`ben${sfx}`, "Ben Sales", "Sales"], [`cy${sfx}`, "Cy Ops", "Ops"]]);
    const dora = `dora${sfx}`, ben = `ben${sfx}`, cy = `cy${sfx}`;
    const D = await connectUser(dora), Bn = await connectUser(ben), C = await connectUser(cy);

    t.section("The enterprise code");
    const orgCode = (await A.sd("admin.org.get")).data.org.code;
    const card = (await http.get(`/api/sd/connect/${orgCode}`)).data;
    ok("anyone can look the enterprise code up (no sign-in)", card?.type === "enterprise" && card.enterprise.name === "Pune Hospital Ltd", card);
    ok("the card carries name, location, code, display form and QR payload", card.enterprise.location?.city === "Mumbai" && card.enterprise.code === orgCode &&
        /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(card.enterprise.display) && card.enterprise.payload === `https://ent.example/connect/${orgCode}` && card.enterprise.url === card.enterprise.payload, card.enterprise);
    ok("the card lists the categories people can register as", card.enterprise.categories.includes("Patient") && !card.enterprise.categories.includes("Gig worker"), card.enterprise.categories);
    const messy = ` ${orgCode.slice(0, 4).toLowerCase()} - ${orgCode.slice(4)} `;
    ok("typing it lower-case, with spaces and a dash still works", (await http.get(`/api/sd/connect/${encodeURIComponent(messy)}`)).data?.type === "enterprise");
    const confusable = orgCode.replace(/0/g, "O").replace(/1/g, "I");
    ok("O/0 and I/1 mix-ups are read the way a person meant them", (await http.get(`/api/sd/connect/${confusable}`)).data?.type === "enterprise", confusable);
    let x = await http.get("/api/sd/connect/ZZZZZZZZ");
    ok("an unknown code is not_found (404)", x.status === 404 && x.error?.code === "not_found", x.json);
    x = await http.get("/api/sd/connect/short");
    ok("a malformed code is not_found too (nothing to enumerate)", x.status === 404, x.json);

    t.section("Personal codes");
    let my = (await D.sd("connect.my")).data;
    const doraCode = my.person.code;
    ok("connect.my gives the caller's own code and the enterprise's", /^[0-9A-Z]{8}$/.test(doraCode) && my.person.username === dora && my.enterprise.code === orgCode, my);
    ok("the person's QR payload also carries the enterprise address", my.person.payload === `https://ent.example/connect/${doraCode}`, my.person.payload);
    ok("asking twice gives the same code (it is stable)", (await D.sd("connect.my")).data.person.code === doraCode);
    const benCode = (await Bn.sd("connect.my")).data.person.code;
    ok("two people never share a code", benCode !== doraCode && benCode !== orgCode);
    x = await http.get(`/api/sd/connect/${doraCode}`);
    ok("a personal code does NOT resolve for anonymous visitors (looks like an unknown code)", x.status === 404 && x.error?.code === "not_found", x.json);

    t.section("Looking a code up (without connecting)");
    m = await D.sd("connect.lookup", { code: benCode });
    ok("a person's code shows their public profile and that you're not connected", m.ok && m.data.type === "person" && m.data.user.username === ben && m.data.connected === false, m);
    ok("...and only public fields (no email or mobile)", !("email" in m.data.user) && !("mobile" in m.data.user), Object.keys(m.data.user));
    m = await D.sd("connect.lookup", { code: orgCode });
    ok("the enterprise code shows the enterprise card", m.ok && m.data.type === "enterprise", m);
    m = await D.sd("connect.lookup", { code: "12345" });
    ok("a malformed code -> invalid_code", !m.ok && m.error.code === "invalid_code", m);
    m = await D.sd("connect.lookup", { code: "ZZZZZZZZ" });
    ok("an unknown code -> not_found", !m.ok && m.error.code === "not_found", m);
    m = await D.sd("connect.lookup", {});
    ok("a missing code is refused", !m.ok, m);

    t.section("Scanning a person's code connects you at once");
    const before = (await D.sd("assoc.list")).data.associates.map((a) => a.user.username);
    ok("(before) Dora and Ben are not associates", !before.includes(ben));
    Bn.inbox.length = 0;
    m = await D.sd("connect.scan", { code: benCode });
    ok("Dora scans Ben's code: connected", m.ok && m.data.type === "person" && m.data.user.username === ben && m.data.alreadyConnected === false, m);
    const afterD = (await D.sd("assoc.list")).data.associates.map((a) => a.user.username);
    const afterB = (await Bn.sd("assoc.list")).data.associates.map((a) => a.user.username);
    ok("the link goes both ways", afterD.includes(ben) && afterB.includes(dora), { afterD, afterB });
    const evt = await Bn.wait((e) => e.type === "sd_event" && e.event === "associate_connected", 3000);
    ok("Ben is told live (associate_connected)", !!evt && evt.data.user === dora && evt.data.via === "code", evt);
    await sleep(300);
    const feed = (await Bn.sd("feed.list")).data;
    ok("...and gets a notification saying who scanned him", JSON.stringify(feed).includes("connected with you by scanning your code"), feed);
    m = await D.sd("connect.scan", { code: benCode });
    ok("scanning again says alreadyConnected (nothing duplicated)", m.ok && m.data.alreadyConnected === true, m);
    m = await D.sd("connect.scan", { code: doraCode });
    ok("scanning your own code is refused", !m.ok && m.error.code === "invalid", m);
    m = await D.sd("connect.scan", { code: orgCode });
    ok("scanning the enterprise code returns its card (you're already a member)", m.ok && m.data.type === "enterprise" && m.data.alreadyMember === true, m);
    m = await D.sd("connect.scan", { code: "ZZZZZZZZ" });
    ok("scanning an unknown code is not_found", !m.ok && m.error.code === "not_found", m);
    m = await D.sd("connect.scan", { code: "bad" });
    ok("scanning a malformed code is invalid_code", !m.ok && m.error.code === "invalid_code", m);
    D.send(`/msg ${ben} hi after scanning`);
    const dm = await D.wait((e) => e.type === "dm_ack", 3000);
    ok("once connected they can chat (the strict-mode 'not associated' rule is satisfied)", !!dm, dm);

    t.section("Replacing your code");
    m = await Bn.sd("connect.rotate");
    const newBen = m.data.person.code;
    ok("rotating gives a different code", m.ok && newBen !== benCode && /^[0-9A-Z]{8}$/.test(newBen), m);
    ok("connect.my now shows the new one", (await Bn.sd("connect.my")).data.person.code === newBen);
    m = await C.sd("connect.scan", { code: benCode });
    ok("the OLD code stops working at once", !m.ok && m.error.code === "not_found", m);
    m = await C.sd("connect.scan", { code: newBen });
    ok("the NEW code works", m.ok && m.data.user.username === ben, m);
    m = await Bn.sd("connect.rotate");
    ok("rotating twice is fine", m.ok && m.data.person.code !== newBen);

    t.section("A deactivated person's code");
    const cyCode = (await C.sd("connect.my")).data.person.code;
    m = await A.sd("admin.user.status", { username: cy, active: false });
    ok("(setup) Cy is deactivated", m.ok, m);
    m = await D.sd("connect.scan", { code: cyCode });
    ok("a deactivated person's code no longer connects anyone", !m.ok && m.error.code === "not_found", m);
    m = await D.sd("connect.lookup", { code: cyCode });
    ok("...and doesn't show their profile", !m.ok && m.error.code === "not_found", m);

    t.section("Registering with the enterprise code");
    r = await http.post("/api/sd/register", { code: "ZZZZZZZZ", name: "New Person", email: `np${sfx}@test.co`, mobile: `+9198760${String(Date.now()).slice(-5)}`, password: "Str0ngPass99x", category: "Patient", country: "India", city: "Pune", pin: "411001" });
    ok("a wrong enterprise code is refused at sign-up", r.error?.code === "invalid_code", r.json);
    r = await http.post("/api/sd/register", { code: orgCode.toLowerCase(), name: "New Person", email: `np${sfx}@test.co`, mobile: `+9198761${String(Date.now()).slice(-5)}`, password: "Str0ngPass99x", category: "Patient", country: "India", city: "Pune", pin: "411001", username: `np${sfx}` });
    ok("the right code (any case) lets the person register as a pending onboarding", r.status === 200 && r.data?.registered === true && r.data.status === "pending", r.json);
    r = await http.post("/api/sd/register", { name: "No Code", email: `nc${sfx}@test.co`, mobile: `+9198762${String(Date.now()).slice(-5)}`, password: "Str0ngPass99x", category: "Patient", country: "India", city: "Pune", pin: "411001", username: `nc${sfx}` });
    ok("without a code registration still works (the code is optional unless the enterprise requires it)", r.status === 200 && r.data?.registered === true, r.json);

    for (const c of [D, Bn, C, A]) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
