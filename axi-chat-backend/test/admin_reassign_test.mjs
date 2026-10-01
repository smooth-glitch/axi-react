// Admin reassignment (department / branch / designation / hosts), privilege checks, audit trail, bulk moves,
// lost-update safety, and invitation email over SMTP (against a fake mail server run by this test).
//
//   redis-cli -n 41 FLUSHDB    (run_all starts Redis with 64 databases)
//   REDIS_DB=41 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_MODE=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=12525 \
//     SMTP_USER=mailer@test.co SMTP_PASS=pw SMTP_STARTTLS=0 erl ... -s chat_app start 5600 8110
//   node test/admin_reassign_test.mjs http://localhost:8110
//
// Also run by `node test/run_all.mjs admin_reassign`.

import net from "node:net";
import { suite, bootstrap, sfx, sleep } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8110";
const SMTP_PORT = Number(process.env.TEST_SMTP_PORT || 12525);
const t = suite("admin_reassign", BASE);
const { ok } = t;

// ---- a tiny fake SMTP server that records every message ------------------------------------------------------------
const mails = [];
function fakeSmtp() {
    return net.createServer((sock) => {
        let buf = "", mode = "cmd", rec = { auth: [], from: null, rcpt: [], data: [] };
        const w = (s) => sock.write(s + "\r\n");
        w("220 fake ESMTP");
        sock.on("data", (d) => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf("\r\n")) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 2);
                if (mode === "data") {
                    if (line === ".") { mails.push(rec); rec = { auth: rec.auth, from: null, rcpt: [], data: [] }; mode = "cmd"; w("250 queued"); }
                    else rec.data.push(line);
                    continue;
                }
                const u = line.toUpperCase();
                if (u.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
                else if (u === "AUTH LOGIN") { rec.step = 1; w("334 VXNlcm5hbWU6"); }
                else if (rec.step) { rec.auth.push(Buffer.from(line, "base64").toString()); w(rec.step++ === 1 ? "334 UGFzc3dvcmQ6" : "235 ok"); if (rec.step > 2) rec.step = 0; }
                else if (u.startsWith("MAIL FROM")) { rec.from = line; w("250 ok"); }
                else if (u.startsWith("RCPT TO")) { rec.rcpt.push(line); w("250 ok"); }
                else if (u === "DATA") { mode = "data"; w("354 go"); }
                else if (u === "QUIT") { w("221 bye"); sock.end(); }
                else w("250 ok");
            }
        });
        sock.on("error", () => {});
    });
}
const mailTo = async (addr, ms = 4000) => {
    for (let waited = 0; waited < ms; waited += 100) {
        const m = mails.find((x) => x.rcpt.some((r) => r.toLowerCase().includes(addr.toLowerCase())));
        if (m) return m;
        await sleep(100);
    }
    return null;
};
const decodeBody = (m) => { const parts = m.data.join("\n").split("\n\n"); return Buffer.from(parts.slice(1).join("").replace(/\s/g, ""), "base64").toString("utf8"); };

async function main() {
    const smtp = fakeSmtp();
    await new Promise((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));
    console.log(`Admin reassignment against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const { A, connectUser, http } = B;
    const short = (m) => m.ok ? "ok" : `${m.error?.code}: ${m.error?.message}`;
    const [raj, h1, h2, u1, u2, mgr] = ["raj", "hops", "hsales", "u1", "u2", "mgr"].map((x) => `${x}${sfx}`);

    for (const d of ["Ops", "Sales"]) await A.sd("admin.cfg.save", { kind: "departments", item: { name: d } });
    for (const b of [["HQ", "Pune", "411001"], ["Mumbai", "Mumbai", "400001"]]) await A.sd("admin.cfg.save", { kind: "branches", item: { name: b[0], country: "India", city: b[1], pin: b[2] } });
    for (const d of ["Analyst", "Manager"]) await A.sd("admin.cfg.save", { kind: "designations", item: { name: d } });
    const scope = (dept) => ({ employees: { any: false, branches: [], departments: [dept], designations: [] }, affiliates: { any: false, selected: [] }, categories: [] });
    const emp = (u, n, dept, extra = {}) => A.sd("users.invite", { name: n, username: u, email: `${u}@test.co`, isEmployee: true, branch: "HQ", department: dept, designation: "Analyst", ...extra });
    await emp(h1, "Host Ops", "Ops", { isHost: true, hostScope: scope("Ops") });
    await emp(h2, "Host Sales", "Sales", { isHost: true, hostScope: scope("Sales") });
    await emp(raj, "Raj", "Ops", { host: h1 });
    await emp(u1, "User One", "Ops", { host: h1 });
    await emp(u2, "User Two", "Ops", { host: h1 });
    const get = async (u) => (await A.sd("admin.user.get", { username: u })).data.user;
    const Raj = await connectUser(raj), Host1 = await connectUser(h1);

    t.section("Invitation email over SMTP");
    const mail = await mailTo(`${raj}@test.co`);
    ok("inviting someone sends them an email", !!mail, mails.length);
    if (mail) {
        const body = decodeBody(mail);
        ok("the mail server was logged into with the configured account", mail.auth[0] === "mailer@test.co" && mail.auth[1] === "pw", mail.auth);
        ok("it is addressed to the person and sent from the configured sender", mail.rcpt.some((r) => r.includes(`${raj}@test.co`)) && /mailer@test\.co/.test(mail.from), { from: mail.from, rcpt: mail.rcpt });
        ok("it has a subject and welcomes them by name", /Subject: You're invited to Connectum/.test(mail.data.join("\n")) && body.includes("Hello Raj"), body.slice(0, 80));
        ok("it carries the sign-in details and where to open the app", body.includes(`Sandesh${raj}`) && body.includes("https://10.0.2.146") && /VPN/.test(body), body);
    }

    t.section("Nobody can grant themselves privileges");
    const org = await A.sd("admin.org.get");
    const code = org.data?.org?.code ?? org.data?.code;
    const reg = await http.post("/api/sd/register", { code, name: "Sneaky Sam", username: `sam${sfx}`, email: `sam${sfx}@test.co`, mobile: "+919876500011", password: "Str0ngPass99x",
        isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst", country: "India", city: "Pune", pin: "411001",
        canManageUsers: true, isHost: true, roles: ["Approver"], role: "admin", hostScope: scope("Ops") });
    ok("self-registration itself still works", reg.status === 200 && reg.data?.registered === true, reg.json);
    const sam = await get(`sam${sfx}`);
    ok("...but a self-registered user is never a host", sam.isHost === false && sam.hostScope === null, { isHost: sam.isHost, hostScope: sam.hostScope });
    ok("...never gets user-management rights, an admin role or roles", sam.canManageUsers === false && sam.role === "user" && (sam.roles ?? []).length === 0, sam);
    {
        const m = await Host1.sd("users.invite", { name: "Eve Ops", username: `eve${sfx}`, email: `eve${sfx}@test.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst",
            isHost: true, canManageUsers: true, roles: ["Approver"], hostScope: scope("Ops") });
        ok("a host can still invite someone in their scope", m.ok, m.error);
        const eve = await get(`eve${sfx}`);
        ok("...but cannot make them a host, a user manager or give roles", eve.isHost === false && eve.canManageUsers === false && (eve.roles ?? []).length === 0, eve);
    }

    t.section("Admin moves people between departments, branches and designations");
    let m = await A.sd("admin.user.update", { username: raj, department: "Sales", branch: "Mumbai", designation: "Manager" });
    ok("admin changes department, branch and designation in one go", m.ok && m.data.user.department === "Sales" && m.data.user.branch === "Mumbai" && m.data.user.designation === "Manager", m);
    const live = (await Raj.sd("profile.get")).data.profile;
    ok("the person's open session sees it immediately", live.department === "Sales" && live.branch === "Mumbai" && live.designation === "Manager", live);
    for (const [what, args] of [["an unknown department", { department: "Nope" }], ["a blank department", { department: "" }], ["an unknown branch", { branch: "Atlantis" }], ["an unknown designation", { designation: "CEO" }]]) {
        m = await A.sd("admin.user.update", { username: raj, ...args });
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    m = await A.sd("admin.user.update", { username: raj, department: "oPs" });
    ok("casing is normalised to the list's spelling", m.ok && m.data.user.department === "Ops", m);
    m = await Raj.sd("admin.user.update", { username: raj, department: "Sales" });
    ok("a normal user cannot change anyone's department", !m.ok && m.error.code === "forbidden", m.error);
    m = await Raj.sd("profile.update", { department: "Sales" });
    ok("...nor their own", !m.ok, m);
    m = await A.sd("admin.user.update", { username: `ghost${sfx}`, department: "Ops" });
    ok("an unknown user is a clean not_found", !m.ok && m.error.code === "not_found", m.error);

    t.section("Hosts follow the move");
    await A.sd("admin.host.change", { user: raj, host: h1 });
    m = await A.sd("admin.user.update", { username: raj, department: "Sales" });
    ok("moving someone out of their host's scope is flagged, not silently ignored", m.ok && m.data.hostMismatch?.host === h1 && m.data.hostMismatch.suggestedHosts.includes(h2), m.data);
    ok("...and the host is left alone unless asked", (await get(raj)).host === h1);
    m = await A.sd("admin.user.update", { username: raj, department: "Ops" });
    ok("moving them back needs no host change", m.ok && !m.data.hostMismatch, m.data);
    m = await A.sd("admin.user.update", { username: raj, department: "Sales", autoHost: true });
    ok("autoHost switches them to a host that covers the new department", m.ok && m.data.hostChanged?.to === h2 && (await get(raj)).host === h2, m.data);
    m = await A.sd("admin.host.change", { user: raj, host: h1 });
    ok("admin.host.change warns when the new host doesn't cover the user (override still allowed)", m.ok && m.data.coversUser === false, m.data);
    m = await A.sd("admin.host.change", { user: raj, host: h2 });
    ok("...and says so when it does", m.ok && m.data.coversUser === true, m.data);

    t.section("A host can't be removed from under their people");
    m = await A.sd("admin.user.update", { username: h1, isHost: false });
    ok("demoting a host who still has people is refused with a count", !m.ok && m.error.code === "has_users" && /\d+ user/.test(m.error.message), m.error);
    ok("...and nothing changed", (await get(h1)).isHost === true);
    m = await A.sd("admin.user.update", { username: h1, isHost: false, reassignTo: h1 });
    ok("reassignTo can't be the same person", !m.ok, m);
    m = await A.sd("admin.user.update", { username: h1, isHost: false, reassignTo: raj });
    ok("reassignTo must be a host or admin", !m.ok, m);
    m = await A.sd("admin.user.update", { username: h1, isHost: false, reassignTo: h2 });
    ok("with reassignTo the demotion goes through and the people move", m.ok && m.data.movedUsers.includes(u1) && m.data.movedUsers.includes(u2) && (await get(u1)).host === h2, m.data);
    m = await A.sd("admin.user.update", { username: h1, isHost: true, hostScope: scope("Ops") });
    ok("they can be made a host again", m.ok && m.data.user.isHost === true, m);
    await A.sd("admin.host.change", { user: u1, host: h2 });
    m = await A.sd("admin.user.update", { username: h2, isHost: true, hostScope: scope("Ops") });
    ok("narrowing a host's scope lists the people no longer covered", m.ok && Array.isArray(m.data.uncoveredUsers) && m.data.uncoveredUsers.includes(raj), m.data);
    await A.sd("admin.user.update", { username: h2, isHost: true, hostScope: scope("Sales") });

    t.section("Deactivating a host");
    m = await A.sd("admin.user.status", { username: h2, active: false });
    ok("without reassignTo the admin gets the list of orphaned people", m.ok && m.data.orphans.length >= 1, m.data);
    await A.sd("admin.user.status", { username: h2, active: true });
    m = await A.sd("admin.user.status", { username: h2, active: false, reassignTo: h1 });
    ok("with reassignTo they are moved in the same call", m.ok && m.data.movedUsers.length >= 1 && m.data.orphans.length === 0 && (await get(raj)).host === h1, m.data);
    m = await A.sd("admin.user.status", { username: h1, active: false, reassignTo: h2 });
    ok("reassignTo must be an active host", !m.ok, m);

    t.section("Bulk move");
    m = await A.sd("admin.users.bulk_move", { kind: "department", from: "Ops", to: "Sales", dryRun: true });
    const opsCount = m.data?.count;
    ok("a dry run counts who would move and changes nothing", m.ok && m.data.dryRun === true && opsCount >= 2 && (await get(u1)).department === "Ops", m.data);
    m = await A.sd("admin.users.bulk_move", { kind: "department", from: "ops", to: "Sales" });
    ok("moves everyone from one department to another (names match in any case)", m.ok && m.data.count === opsCount && m.data.failed.length === 0 && (await get(u1)).department === "Sales" && (await get(u2)).department === "Sales", m.data);
    ok("...and reports hosts that no longer cover people", Array.isArray(m.data.hostMismatch), m.data);
    m = await A.sd("admin.cfg.delete", { kind: "departments", name: "Ops" });
    ok("...so the emptied department can finally be deleted", m.ok, m.error);
    m = await A.sd("admin.users.bulk_move", { kind: "branch", from: "HQ", to: "Mumbai" });
    ok("works for branches too", m.ok && m.data.count >= 1, m.data);
    for (const [what, args] of [["an unknown target", { kind: "department", from: "Sales", to: "Nope" }], ["the same from and to", { kind: "department", from: "Sales", to: "sales" }],
        ["an unknown kind", { kind: "planet", from: "a", to: "b" }], ["missing values", { kind: "department" }]]) {
        m = await A.sd("admin.users.bulk_move", args);
        ok(`bulk move with ${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    m = await Raj.sd("admin.users.bulk_move", { kind: "department", from: "Sales", to: "Sales2" });
    ok("only admins can bulk move", !m.ok && m.error.code === "forbidden", m.error);

    t.section("Every change is recorded and the person is told");
    m = await A.sd("admin.audit.list", { username: raj, limit: 100 });
    const upd = (m.data?.entries ?? []).find((e) => e.action === "user.update" && e.details?.changes?.department);
    ok("the audit log shows who changed what, before and after", m.ok && upd && upd.actor === B.adminName && upd.target === raj && upd.details.changes.department.from && upd.details.changes.department.to, upd);
    ok("host changes, status changes and bulk moves are logged too", (await A.sd("admin.audit.list", { limit: 200 })).data.entries.map((e) => e.action).filter((a) => ["host.change", "user.status", "users.bulk_move"].includes(a)).length >= 3);
    ok("only admins can read the audit log", !(await Raj.sd("admin.audit.list")).ok);
    await sleep(500);
    const feed = await Raj.sd("feed.list");
    ok("the affected person gets a notice that their details changed", JSON.stringify(feed.data ?? {}).includes("Your details were updated"), feed.error ?? "no notice");

    t.section("No lost updates");
    let lostAdmin = 0, lostSelf = 0; const N = 25;
    await Raj.sd("profile.update", { skills: ["init"] });
    for (let i = 0; i < N; i++) {
        const skills = [`s${i}`], city = `City${i}`;
        await Promise.all([A.sd("admin.user.update", { username: raj, city, country: "India", pin: "411001" }), Raj.sd("profile.update", { skills })]);
        const p = await get(raj);
        if (p.city !== city) lostAdmin++;
        if (JSON.stringify(p.skills) !== JSON.stringify(skills)) lostSelf++;
    }
    ok(`${N} simultaneous admin edits + self edits: the person's own edit never disappears`, lostSelf === 0, { lostSelf });
    ok(`...and the admin's edit never disappears either`, lostAdmin === 0, { lostAdmin });
    const par = await Promise.all(Array.from({ length: 12 }, (_, i) => A.sd("admin.user.update", { username: u1, designation: i % 2 ? "Manager" : "Analyst" })));
    ok("12 parallel admin edits of one person all succeed", par.every((x) => x.ok), par.find((x) => !x.ok)?.error);

    t.section("Two admins can't both remove each other");
    await A.sd("admin.admins.add", { username: h1 });
    const rs = await Promise.all([A.sd("admin.admins.remove", { username: B.adminName }), A.sd("admin.admins.remove", { username: h1 })]);
    const okCount = rs.filter((r) => r.ok).length;
    ok("exactly one removal succeeds and the other is refused (last administrator, or no longer an admin)", okCount === 1 && rs.some((r) => ["last_admin", "forbidden"].includes(r.error?.code)), rs.map(short));
    // Exactly one of the two removals took effect, so exactly one administrator remains (the rule held under a race).

    smtp.close();
    for (const c of [A, Raj, Host1]) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
