// WhatsApp-parity chat additions: message edit (global / DM / group) and richer uploads (video, PDF, Office, text).
// Runs against an open-mode backend started with CHAT_EDIT_WINDOW_SEC=3.
import { suite, sleep, sfx, Client } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8103";
const t = suite("connectum_chat", BASE);
const { ok } = t;

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(300)]);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(200, 1)]);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(50)]);

async function upload(bytes, type, name = "f.bin") {
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type }), name);
    const r = await fetch(`${BASE}/upload`, { method: "POST", body: fd });
    let body = null; try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, body };
}
const mk = async (n) => new Client(BASE, n).connect("tok-" + n);

async function main() {
    const [a, b, c] = [`ea${sfx}`, `eb${sfx}`, `ec${sfx}`];
    const [A, B, C] = [await mk(a), await mk(b), await mk(c)];
    const drain = () => { for (const x of [A, B, C]) x.inbox.length = 0; };

    t.section("Edit: global room");
    A.send("hello everyone");
    let m = await B.wait((x) => x.type === "message" || x.type === "chat" || (x.text === "hello everyone"), 3000);
    const gid = m?.id ?? m?.messageId;
    ok("a message was posted (and has an id)", !!gid, m);
    drain();
    A.send(`/edit global ${gid} hello, world`);
    m = await B.wait((x) => x.type === "edited", 3000);
    ok("everyone in the room sees the edit", m && m.messageId === gid && m.text === "hello, world" && m.scope === "global" && m.editedTs > 0, m);
    ok("...including the sender", !!(await A.wait((x) => x.type === "edited", 2000)));
    B.send(`/edit global ${gid} hijacked`);
    m = await B.wait((x) => x.type === "edit_denied", 3000);
    ok("someone else can't edit it", m && m.reason === "forbidden", m);
    A.send(`/edit global 99999999 nope`);
    m = await A.wait((x) => x.type === "edit_denied", 3000);
    ok("an unknown message is refused", m && m.reason === "not_found", m);
    A.send(`/edit global ${gid}`);
    m = await A.wait((x) => x.type === "error", 3000);
    ok("missing text is a usage error", m && /Usage/.test(m.message || m.text || ""), m);
    A.send(`/edit global ${gid} ${"x".repeat(2100)}`);
    m = await A.wait((x) => x.type === "error", 3000);
    ok("over-long text is refused", m && /too long/i.test(m.message || m.text || ""), m);
    A.send("/history global");
    m = await A.wait((x) => x.type === "history" && x.scope === "global", 3000);
    const item = m.list.find((x) => x.id === gid);
    ok("history shows the new text with editedTs", item && item.text === "hello, world" && item.editedTs > 0, item);
    ok("...and editedTs is null for a message never edited", m.list.some((x) => x.editedTs === null) || m.list.length === 1, m.list.map((x) => x.editedTs));

    t.section("Edit: direct messages");
    A.send(`/msg ${b} secret plan`);
    m = await A.wait((x) => x.type === "dm_ack", 3000);
    const did = m.id;
    drain();
    A.send(`/edit dm ${b} ${did} better plan`);
    m = await B.wait((x) => x.type === "dm_edited", 3000);
    ok("the other person sees a DM edit", m && m.text === "better plan" && m.messageId === did, m);
    ok("...the sender too", !!(await A.wait((x) => x.type === "dm_edited", 2000)));
    ok("...but a third person does not", await C.inbox.every((x) => x.type !== "dm_edited"));
    A.send(`/edit global ${did} leak it`);
    m = await A.wait((x) => x.type === "edit_denied", 3000);
    ok("a DM can't be 'edited' as if it were a global message (no leak)", m && m.reason === "forbidden" && C.inbox.every((x) => x.type !== "edited"), m);
    A.send(`/edit dm ${c} ${did} wrong conversation`);
    m = await A.wait((x) => x.type === "edit_denied", 3000);
    ok("nor through a different conversation", !!m, m);

    t.section("Edit: groups");
    const g = `grp${sfx}`;
    A.send(`/creategroup ${g}`);
    await A.wait((x) => x.type === "group_created", 3000);
    A.send(`/addmember ${g} ${b}`);
    await sleep(300);
    A.send(`/groupmsg ${g} first draft`);
    m = await A.wait((x) => x.type === "group_msg_ack", 3000);
    const grid = m.id;
    drain();
    A.send(`/edit group ${g} ${grid} final draft`);
    m = await B.wait((x) => x.type === "group_edited", 3000);
    ok("members see the edit", m && m.group === g && m.text === "final draft" && m.messageId === grid, m);
    ok("a non-member does not", C.inbox.every((x) => x.type !== "group_edited"));
    B.send(`/edit group ${g} ${grid} not mine`);
    m = await B.wait((x) => x.type === "edit_denied", 3000);
    ok("a member can't edit someone else's message", m && m.reason === "forbidden", m);

    t.section("Edit window");
    A.send("short lived");
    m = await B.wait((x) => x.text === "short lived", 3000);
    const sid = m.id ?? m.messageId;
    await sleep(3500);
    drain();
    A.send(`/edit global ${sid} too late`);
    m = await A.wait((x) => x.type === "edit_denied", 3000);
    ok("after the window (3 s in this test) an edit is refused as expired", m && m.reason === "expired", m);
    A.send(`/delete global ${sid}`);
    await sleep(400);
    A.send(`/edit global ${sid} zombie`);
    m = await A.wait((x) => x.type === "edit_denied", 3000);
    ok("a deleted message can't be edited", m && (m.reason === "deleted" || m.reason === "expired"), m);

    t.section("Uploads: what is accepted");
    const cases = [
        ["MP4 video", mp4, "video/mp4", ".mp4"], ["PDF", pdf, "application/pdf", ".pdf"],
        ["Word document", zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
        ["Excel sheet", zip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
        ["plain text", Buffer.from("hello ü world\n"), "text/plain", ".txt"], ["image (as before)", png, "image/png", ".png"],
    ];
    const urls = {};
    for (const [what, bytes, type, ext] of cases) {
        const r = await upload(bytes, type, `my file${ext}`);
        ok(`${what} is accepted`, r.status === 200 && r.body.url.endsWith(ext) && r.body.type === type && r.body.size === bytes.length && r.body.name === `my file${ext}`, r);
        urls[ext] = r.body?.url;
    }
    t.section("Uploads: what is refused");
    let r = await upload(Buffer.from("MZ not a pdf"), "application/pdf", "evil.pdf");
    ok("a file that isn't what it says is refused", r.status === 415, r);
    r = await upload(pdf, "application/x-msdownload", "a.exe");
    ok("an unknown type is refused", r.status === 415, r);
    r = await upload(Buffer.from([1, 2, 0, 3]), "text/plain", "bin.txt");
    ok("'text' with NUL bytes is refused", r.status === 415, r);
    r = await upload(Buffer.from([0xff, 0xfe, 0xfd]), "text/plain", "bad.txt");
    ok("'text' that isn't UTF-8 is refused", r.status === 415, r);
    r = await upload(Buffer.alloc(0), "application/pdf", "e.pdf");
    ok("an empty file is refused", r.status === 400 || r.status === 415, r);
    r = await upload(Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]), "image/png", "big.png");
    ok("an image over 8 MB is still refused", r.status === 413 && /8 MB/.test(r.body.error), r);
    r = await upload(Buffer.concat([pdf, Buffer.alloc(21 * 1024 * 1024)]), "application/pdf", "big.pdf");
    ok("a document over 20 MB is refused", r.status === 413 && /20 MB/.test(r.body.error), r);
    r = await upload(Buffer.concat([mp4, Buffer.alloc(12 * 1024 * 1024)]), "video/mp4", "ok.mp4");
    ok("a 12 MB video is fine", r.status === 200, r.status);
    r = await upload(pdf, "application/pdf", "../../etc/pa\"ss\nwd.pdf");
    ok("the shown file name has no path or control characters", r.status === 200 && r.body.name === "passwd.pdf" || r.body?.name === "etcpasswd.pdf" || (r.status === 200 && !/[\/\\"\n]/.test(r.body.name)), r);

    t.section("Serving");
    let g1 = await fetch(BASE + urls[".pdf"]);
    ok("a PDF is served with its type, nosniff and as an attachment", g1.status === 200 && g1.headers.get("content-type") === "application/pdf" && g1.headers.get("x-content-type-options") === "nosniff" && /attachment/.test(g1.headers.get("content-disposition") || ""), [...g1.headers]);
    g1 = await fetch(BASE + urls[".mp4"], { headers: { range: "bytes=0-9" } });
    ok("a video honours Range requests and is not an attachment", g1.status === 206 && g1.headers.get("content-type") === "video/mp4" && !g1.headers.get("content-disposition"), g1.status);
    g1 = await fetch(BASE + urls[".png"]);
    ok("images are served as before (inline)", g1.status === 200 && g1.headers.get("content-type") === "image/png" && !g1.headers.get("content-disposition"));
    g1 = await fetch(BASE + urls[".txt"]);
    ok("text is served as UTF-8 text", g1.status === 200 && /^text\/plain/.test(g1.headers.get("content-type")) && (await g1.text()).includes("ü"));

    for (const x of [A, B, C]) x.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
