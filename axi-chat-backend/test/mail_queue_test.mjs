// The durable mail queue: an invitation sent while the mail server is DOWN is kept and delivered when it comes back;
// permanent refusals and exhausted retries end up in the dead list; one-time codes are never queued; the admin can see all of it.
//
//   redis-cli -n 47 FLUSHDB
//   REDIS_DB=47 SANDESH_DEV_OTP=1 SANDESH_OTP_MODE=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=12527 SMTP_USER=mailer@test.co SMTP_PASS=pw \
//     SMTP_STARTTLS=0 SMTP_RETRY_DELAYS_MS=0,400,400,400,400 SANDESH_SCHEDULER_TICK_MS=250 erl ... -s chat_app start 5640 8150
//   node test/mail_queue_test.mjs http://localhost:8150
//
// Also run by `node test/run_all.mjs mail_queue`.

import net from "node:net";
import { suite, bootstrap, sfx, sleep } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8150";
const SMTP_PORT = Number(process.env.TEST_SMTP_PORT || 12527);
const t = suite("mail_queue", BASE);
const { ok } = t;

const mails = []; const attempts = {};
function fakeSmtp() {
    return net.createServer((sock) => {
        let buf = "", mode = "cmd", rec = { rcpt: [], data: [] }, step = 0;
        const w = (s) => sock.write(s + "\r\n");
        w("220 fake ESMTP");
        sock.on("data", (d) => {
            buf += d.toString(); let i;
            while ((i = buf.indexOf("\r\n")) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 2);
                if (mode === "data") { if (line === ".") { mails.push(rec); rec = { rcpt: [], data: [] }; mode = "cmd"; w("250 queued"); } else rec.data.push(line); continue; }
                const u = line.toUpperCase();
                if (u.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
                else if (u === "AUTH LOGIN") { step = 1; w("334 VXNlcm5hbWU6"); }
                else if (step === 1) { step = 2; w("334 UGFzc3dvcmQ6"); }
                else if (step === 2) { step = 0; w("235 ok"); }
                else if (u.startsWith("MAIL FROM")) w("250 ok");
                else if (u.startsWith("RCPT TO")) {
                    const to = (line.match(/<([^>]+)>/) || [])[1] || ""; const local = to.split("@")[0];
                    attempts[to] = (attempts[to] || 0) + 1;
                    if (local.startsWith("busy")) w("421 try again later");        // temporary, every time
                    else if (local.startsWith("bad")) w("550 no such mailbox");     // permanent
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
const mailTo = async (addr, ms = 8000) => { for (let w = 0; w < ms; w += 100) { const m = mails.find((x) => x.rcpt.includes(addr)); if (m) return m; await sleep(100); } return null; };

async function main() {
    console.log(`Mail queue against ${BASE}\n`);
    const B = await bootstrap(BASE);     // the setup code goes out by email too, while the mail server is still down: it must not be queued
    const { A } = B;
    await A.sd("admin.cfg.save", { kind: "departments", item: { name: "Ops" } });
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    const invite = (u) => A.sd("users.invite", { name: `P ${u}`, username: u, email: `${u}@test.co`, isEmployee: true, branch: "HQ", department: "Ops", designation: "Analyst" });
    const [q1, q2, bad, busy] = ["qone", "qtwo", "badq", "busyq"].map((x) => x + sfx);

    t.section("The mail server is down when invitations are sent");
    let m = await invite(q1); ok("the invitation is accepted right away", m.ok, m.error);
    m = await invite(q2); ok("...and a second one", m.ok, m.error);
    await sleep(700);
    let q = await A.sd("admin.mail.queue");
    ok("admin.mail.queue lists them as waiting, with the attempt count and when the next try is", q.ok && q.data.pending.some((j) => j.to === `${q1}@test.co` && j.attempts >= 1 && j.nextTs > 0) && q.data.counts.pending >= 2, q.data);
    ok("...with the reason of the last failure, and never the message body", q.data.pending.every((j) => !("body" in j)) && q.data.pending.some((j) => j.lastError), q.data.pending[0]);

    t.section("The mail server comes back");
    const smtp = fakeSmtp(); await new Promise((r) => smtp.listen(SMTP_PORT, "127.0.0.1", r));
    const got1 = await mailTo(`${q1}@test.co`), got2 = await mailTo(`${q2}@test.co`);
    ok("both waiting invitations are delivered by themselves", !!got1 && !!got2, { got1: !!got1, got2: !!got2 });
    await sleep(600);
    q = await A.sd("admin.mail.queue");
    ok("the queue is empty afterwards", q.data.counts.pending === 0, q.data.pending);
    ok("each was delivered exactly once", mails.filter((x) => x.rcpt.includes(`${q1}@test.co`)).length === 1 && mails.filter((x) => x.rcpt.includes(`${q2}@test.co`)).length === 1);

    t.section("Giving up");
    m = await invite(bad); ok("an address the server refuses for good is still created", m.ok);
    await sleep(1200);
    q = await A.sd("admin.mail.queue");
    ok("a permanent refusal goes straight to the dead list after one attempt", q.data.dead.some((j) => j.to === `${bad}@test.co` && j.attempts === 1 && /550/.test(j.lastError)) && attempts[`${bad}@test.co`] === 1, q.data.dead.map((j) => [j.to, j.attempts]));
    ok("...without the message body", q.data.dead.every((j) => !("body" in j)));
    m = await invite(busy); ok("an address that always says 'try later' is accepted", m.ok);
    await sleep(3500);
    q = await A.sd("admin.mail.queue");
    ok("after the retries run out it is listed as failed, having been tried 5 times", q.data.dead.some((j) => j.to === `${busy}@test.co` && j.attempts === 5) && attempts[`${busy}@test.co`] === 5, { attempts: attempts[`${busy}@test.co`], dead: q.data.dead.map((j) => [j.to, j.attempts]) });
    ok("nothing stays in the waiting list", q.data.counts.pending === 0, q.data.pending);

    t.section("One-time codes are not queued");
    const unlock = await A.sd("admin.unlock.start");
    ok("a code is requested", unlock.ok && unlock.data.sent === true, unlock.error);
    await sleep(600);
    q = await A.sd("admin.mail.queue");
    ok("no code is ever stored in the queue (waiting or dead)", ![...q.data.pending, ...q.data.dead].some((j) => j.kind === "otp"));
    ok("...yet the code email is delivered", mails.some((x) => Buffer.from(x.data.join("\n").split("\n\n").slice(1).join("").replace(/\s/g, ""), "base64").toString().includes("Your code:")));

    t.section("Who can see the queue");
    const U = await B.connectUser(q1);
    ok("an ordinary person cannot", !(await U.sd("admin.mail.queue")).ok);

    smtp.close(); A.close(); U.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
