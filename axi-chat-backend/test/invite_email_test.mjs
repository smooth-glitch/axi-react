// Invitation email: wording, retry of transient failures, no retry of permanent ones, resend rules, audit paging.
//
//   redis-cli -n 45 FLUSHDB    (run_all starts Redis with 64 databases)
//   REDIS_DB=45 SANDESH_DEV_OTP=1 SANDESH_OTP_MODE=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=12526 SMTP_USER=mailer@test.co \
//     SMTP_PASS=pw SMTP_STARTTLS=0 SMTP_RETRY_DELAYS_MS=0,300,600 erl ... -s chat_app start 5620 8130
//   node test/invite_email_test.mjs http://localhost:8130
//
// Also run by `node test/run_all.mjs invite_email`.

import net from "node:net";
import { suite, bootstrap, sfx, sleep } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8130";
const SMTP_PORT = Number(process.env.TEST_SMTP_PORT || 12526);
const t = suite("invite_email", BASE);
const { ok } = t;

// ---- a fake mail server: recipients starting with "flaky" get a 421 on their first try, "bad" a 550 every time ----
const mails = [];
const attempts = {};            // recipient -> number of delivery attempts seen
function fakeSmtp() {
    return net.createServer((sock) => {
        let buf = "", mode = "cmd", rec = { rcpt: [], data: [] }, step = 0;
        const w = (s) => sock.write(s + "\r\n");
        w("220 fake ESMTP");
        sock.on("data", (d) => {
            buf += d.toString();
            let i;
            while ((i = buf.indexOf("\r\n")) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 2);
                if (mode === "data") {
                    if (line === ".") { mails.push(rec); rec = { rcpt: [], data: [] }; mode = "cmd"; w("250 queued"); } else rec.data.push(line);
                    continue;
                }
                const u = line.toUpperCase();
                if (u.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
                else if (u === "AUTH LOGIN") { step = 1; w("334 VXNlcm5hbWU6"); }
                else if (step === 1) { step = 2; w("334 UGFzc3dvcmQ6"); }
                else if (step === 2) { step = 0; w("235 ok"); }
                else if (u.startsWith("MAIL FROM")) w("250 ok");
                else if (u.startsWith("RCPT TO")) {
                    const to = (line.match(/<([^>]+)>/) || [])[1] || "";
                    const local = to.split("@")[0];
                    attempts[to] = (attempts[to] || 0) + 1;
                    if (local.startsWith("flaky") && attempts[to] === 1) w("421 try again later");
                    else if (local.startsWith("bad")) w("550 no such mailbox");
                    else { rec.rcpt.push(to); w("250 ok"); }
                }
                else if (u === "DATA") { mode = "data"; w("354 go"); }
                else if (u === "QUIT") { w("221 bye"); sock.end(); }
                else w("250 ok");
            }
        });
        sock.on("error", () => {});
    });
}
const mailTo = async (addr, ms = 5000) => {
    for (let waited = 0; waited < ms; waited += 100) {
        const m = mails.find((x) => x.rcpt.some((r) => r.toLowerCase() === addr.toLowerCase()));
        if (m) return m;
        await sleep(100);
    }
    return null;
};
const body = (m) => Buffer.from(m.data.join("\n").split("\n\n").slice(1).join("").replace(/\s/g, ""), "base64").toString("utf8");

async function main() {
    const smtp = fakeSmtp();
    await new Promise((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));
    console.log(`Invitation email against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const { A, connectUser } = B;
    for (const d of ["Ops"]) await A.sd("admin.cfg.save", { kind: "departments", item: { name: d } });
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    const scope = { employees: { any: false, branches: [], departments: ["Ops"], designations: [] }, affiliates: { any: false, selected: [] }, categories: [] };
    const invite = (username, extra = {}) => A.sd("users.invite", { name: `Person ${username}`, username, email: `${username}@test.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst", ...extra });
    const [okU, flaky, bad, w1, w2, host1, host2, seen] = ["okp", "flakyp", "badp", "wu1", "wu2", "hostone", "hosttwo", "seenp"].map((x) => x + sfx);

    t.section("What the invitation says");
    let m = await invite(okU);
    ok("inviting works", m.ok, m.error);
    const mail = await mailTo(`${okU}@test.co`);
    ok("the email arrives", !!mail);
    const text = mail ? body(mail) : "";
    ok("it gives the username", text.includes(`Your username: ${okU}`), text);
    ok("it explains the authenticator sign-in", /authenticator/i.test(text) && /QR code/.test(text), text);
    ok("it does not mention a temporary password to type", !/Sandesh${okU}/.test(text) && /do not need a password/i.test(text), text);

    t.section("Temporary failures are retried, permanent ones are not");
    m = await invite(flaky);
    ok("the invitation is accepted even though the mail server says 'try later' at first", m.ok, m.error);
    const fm = await mailTo(`${flaky}@test.co`, 6000);
    ok("the email is delivered on a retry", !!fm && attempts[`${flaky}@test.co`] >= 2, { attempts: attempts[`${flaky}@test.co`] });
    m = await invite(bad);
    ok("an invitation to an address the server refuses for good is still created", m.ok, m.error);
    await sleep(2500);
    ok("...and is tried once only, never retried", attempts[`${bad}@test.co`] === 1 && !mails.some((x) => x.rcpt.includes(`${bad}@test.co`)), { attempts: attempts[`${bad}@test.co`] });

    t.section("Re-sending an invitation");
    await invite(w1); await invite(w2);
    await invite(host1, { isHost: true, hostScope: scope }); await invite(host2, { isHost: true, hostScope: scope });
    await sleep(600);
    const before = mails.filter((x) => x.rcpt.includes(`${w1}@test.co`)).length;
    m = await A.sd("users.resend_invite", { username: w1 });
    ok("an administrator can re-send", m.ok && m.data.sent === true, m.error);
    await sleep(900);
    ok("...and a second email goes out", mails.filter((x) => x.rcpt.includes(`${w1}@test.co`)).length === before + 1, { before, now: mails.filter((x) => x.rcpt.includes(`${w1}@test.co`)).length });
    m = await A.sd("users.resend_invite", { username: w1 });
    ok("a second click within a minute is refused", !m.ok && m.error.code === "rate_limited", m.error);
    await A.sd("admin.host.change", { user: w2, host: host1 });
    const H1 = await connectUser(host1), H2 = await connectUser(host2);
    m = await H2.sd("users.resend_invite", { username: w2 });
    ok("a host who is not their host cannot", !m.ok && m.error.code === "forbidden", m.error);
    m = await H1.sd("users.resend_invite", { username: w2 });
    ok("their own host can", m.ok, m.error);
    m = await A.sd("users.resend_invite", { username: `nobody${sfx}` });
    ok("an unknown person is a clean not_found", !m.ok && m.error.code === "not_found", m.error);
    await invite(seen); const S = await connectUser(seen);
    m = await A.sd("users.resend_invite", { username: seen });
    ok("someone who has already signed in is refused", !m.ok && /already signed in/i.test(m.error.message), m.error);
    m = await S.sd("users.resend_invite", { username: w1 });
    ok("an ordinary person cannot re-send anything", !m.ok, m.error);
    await A.sd("admin.user.status", { username: w1, active: false });
    m = await A.sd("users.resend_invite", { username: w1 });
    ok("a deactivated person is refused", !m.ok && /active/i.test(m.error.message), m.error);

    t.section("Audit log paging");
    m = await A.sd("admin.audit.list", { limit: 3, offset: 0 });
    ok("the first page has 3 entries and says more follow", m.ok && m.data.entries.length === 3 && m.data.hasMore === true && m.data.total > 3, { n: m.data?.entries?.length, total: m.data?.total });
    const total = m.data.total;
    let m2 = await A.sd("admin.audit.list", { limit: 3, offset: 3 });
    ok("the next page does not repeat the first", m2.data.entries.every((e) => !m.data.entries.some((x) => x.ts === e.ts && x.action === e.action && x.target === e.target)));
    const seenAll = [];
    for (let off = 0; off < total; off += 3) seenAll.push(...(await A.sd("admin.audit.list", { limit: 3, offset: off })).data.entries);
    ok("walking all pages returns every entry once", seenAll.length === total, { got: seenAll.length, total });
    ok("a re-sent invitation is in the log", seenAll.some((e) => e.action === "user.resend_invite" && e.target === w1));
    m = await A.sd("admin.audit.list", { limit: 5, offset: 100000 });
    ok("an offset past the end is an empty page, not an error", m.ok && m.data.entries.length === 0 && m.data.hasMore === false);
    m = await A.sd("admin.audit.list", { username: w1, limit: 50 });
    ok("filtering by person still works", m.ok && m.data.entries.length >= 1 && m.data.entries.every((e) => e.target === w1 || e.actor === w1));

    smtp.close();
    for (const c of [A, H1, H2, S]) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
