// Edge cases and robustness for the #command layer, over real sockets:
//  - malformed bytes a browser can't produce (invalid UTF-8), sent with a raw
//    RFC 6455 client, and proof the connection survives them
//  - exact size boundaries (2000-byte line, argument limits)
//  - suggestion ordering, caps, self-exclusion, group/host argument types
//  - a concurrent burst from many clients, then a check the server still answers
//
//   node test/hash_commands_edge_test.mjs [port]     (open mode; start the
//   backend with CHAT_RATE_LIMIT_MAX=1000)
// Node 22+, no dependencies.

import net from "node:net";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 8081);
const URL = `ws://localhost:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- normal client (browser-style WebSocket) ------------------------------------------------
class Client {
    constructor(name) {
        this.name = name; this.inbox = []; this.waiters = [];
        this.ws = new WebSocket(URL);
        this.opened = new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.opened.catch(() => {});
        this.ws.addEventListener("message", (ev) => {
            const m = JSON.parse(ev.data); this.inbox.push(m);
            for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].pred(m)) { this.waiters[i].resolve(m); this.waiters.splice(i, 1); }
        });
    }
    async login() { await this.opened; this.ws.send(JSON.stringify({ username: this.name, token: "t-" + this.name })); await this.next(m => m.type === "welcome"); return this; }
    next(pred, ms = 4000, label = "message") {
        const hit = this.inbox.find(pred); if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    fresh(pred, ms = 4000, label = "message") {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    ask(line, pred, ms = 4000) { const p = this.fresh(pred, ms, `reply to ${line.slice(0, 40)}`); this.ws.send(line); return p; }
    complete(input) { return this.ask("/cmdcomplete " + JSON.stringify({ input }), m => m.type === "cmd_suggestions" && m.input === input); }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ---- raw RFC 6455 client: can send ANY bytes as a text frame --------------------------------
class Raw {
    static async connect() {
        const r = new Raw();
        r.sock = net.connect(PORT, "127.0.0.1");
        r.buf = Buffer.alloc(0); r.frames = []; r.waiters = []; r.headerDone = false; r.closed = false;
        r.sock.on("data", d => r.onData(d));
        r.sock.on("close", () => { r.closed = true; });
        r.sock.on("error", () => { r.closed = true; });
        await new Promise(res => r.sock.once("connect", res));
        const key = crypto.randomBytes(16).toString("base64");
        r.sock.write(`GET / HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        await r.waitHeader();
        return r;
    }
    waitHeader() { return new Promise(res => { this._hdr = res; this.check(); }); }
    onData(d) { this.buf = Buffer.concat([this.buf, d]); this.check(); }
    check() {
        if (!this.headerDone) {
            const i = this.buf.indexOf("\r\n\r\n");
            if (i < 0) return;
            this.buf = this.buf.subarray(i + 4); this.headerDone = true; this._hdr?.();
        }
        for (;;) {   // server->client frames are unmasked
            if (this.buf.length < 2) return;
            const op = this.buf[0] & 0x0f; let len = this.buf[1] & 0x7f, off = 2;
            if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
            if (this.buf.length < off + len) return;
            const payload = this.buf.subarray(off, off + len); this.buf = this.buf.subarray(off + len);
            if (op === 1) { const m = JSON.parse(payload.toString("utf8")); this.frames.push(m); this.waiters = this.waiters.filter(w => !(w.pred(m) && (w.resolve(m), true))); }
        }
    }
    sendText(bytes) {   // bytes: Buffer, sent raw (masked, as a client must)
        const mask = crypto.randomBytes(4), n = bytes.length;
        const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : n < 65536 ? Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255]) : null;
        const masked = Buffer.from(bytes.map((b, i) => b ^ mask[i % 4]));
        this.sock.write(Buffer.concat([head, mask, masked]));
    }
    next(pred, ms = 4000, label = "frame") {
        const hit = this.frames.find(pred); if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout waiting for " + label)), ms); this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } }); });
    }
    fresh(pred, ms = 4000, label = "frame") {
        return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout waiting for " + label)), ms); this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } }); });
    }
    close() { this.sock.destroy(); }
}

const sfx = Date.now() % 1e9;

async function main() {
    console.log(`Edge cases at ${URL}\n`);
    const A = await new Client(`ea${sfx}`).login(), B = await new Client(`eb${sfx}`).login();

    console.log("=== Bytes a browser cannot send (raw socket) ===");
    const R = await Raw.connect();
    R.sendText(Buffer.from(JSON.stringify({ username: `er${sfx}`, token: "t" })));
    await R.next(m => m.type === "welcome");
    const bad = (label, bytes, code) => R.fresh(m => m.type === "error" && m.code === code, 3000, label).then(m => (R.sendText(bytes), m));
    for (const [label, bytes] of [
        ["lone continuation byte", Buffer.concat([Buffer.from("#dm bob "), Buffer.from([0x80])])],
        ["0xff in the text", Buffer.concat([Buffer.from("#dm bob hi "), Buffer.from([0xff, 0xfe])])],
        ["truncated 3-byte sequence", Buffer.concat([Buffer.from("#remind x "), Buffer.from([0xe2, 0x82])])],
        ["overlong encoding of '/'", Buffer.concat([Buffer.from("#dm bob "), Buffer.from([0xc0, 0xaf])])],
        ["invalid UTF-8 in the command word", Buffer.concat([Buffer.from("#d"), Buffer.from([0xff]), Buffer.from("m x y")])],
    ]) {
        const p = R.fresh(m => m.type === "error", 3000, label);
        R.sendText(bytes);
        const m = await p.catch(e => ({ type: "timeout", text: e.message }));
        ok(`${label} -> a clean error (${m.code})`, m.type === "error" && ["invalid_encoding", "unknown_command", "usage"].includes(m.code), m);
    }
    const p1 = R.fresh(m => m.type === "cmd_suggestions" || (m.type === "error" && m.code), 3000);
    R.sendText(Buffer.concat([Buffer.from('/cmdcomplete {"input":"#dm '), Buffer.from([0xff]), Buffer.from('"}')]));
    const cm = await p1.catch(e => ({ type: "timeout" }));
    ok("/cmdcomplete with invalid UTF-8 -> an error, not a crash", cm.type === "error", cm);
    const p2 = R.fresh(m => m.type === "cmd_catalog", 3000);
    R.sendText(Buffer.from("/cmds " + "\xff"));
    const cc = await p2.catch(() => ({ type: "timeout" }));
    ok("/cmds with a junk filter -> empty catalog, not a crash", cc.type === "cmd_catalog" && cc.commands.length === 0, cc.type);
    const p3 = R.fresh(m => m.type === "users", 3000);
    R.sendText(Buffer.from("#users"));
    ok("the raw connection is still alive and serving after all of that", !!(await p3.catch(() => null)));
    R.close();

    console.log("=== Size boundaries ===");
    const overhead = `#dm ${B.name} `.length;
    const exact = "x".repeat(2000 - overhead);
    let ack = await A.ask(`#dm ${B.name} ${exact}`, m => m.type === "dm_ack" || m.type === "error");
    ok("a 2000-byte #dm line is accepted", ack.type === "dm_ack", ack);
    let over = await A.ask(`#dm ${B.name} ${exact}y`, m => m.type === "dm_ack" || m.type === "error");
    ok("a 2001-byte #dm line is refused as too long", over.type === "error" && /too long/i.test(over.text), over);
    over = await A.ask("#" + "a".repeat(2100), m => m.type === "error");
    ok("an oversized junk #line is refused, not processed", /too long/i.test(over.text), over);
    over = await A.ask(`#remind ${"x".repeat(600)}`, m => m.type === "error");
    ok("#remind text over its 500 limit -> usage", over.code === "usage" && /too long/.test(over.text), over);
    over = await A.ask(`#status ${"x".repeat(141)}`, m => m.type === "error");
    ok("#status over 140 -> usage", over.code === "usage", over);
    A.ws.send(`#status ${"s".repeat(140)}`);
    await sleep(300);
    const prof = await B.ask(`#profile ${A.name}`, m => m.type === "profile" && m.user === A.name);
    ok("...and stored in full", prof.status.length === 140, prof.status?.length);
    over = await A.ask(`#historydm ${"u".repeat(25)}`, m => m.type === "error");
    ok("a 25-char username argument -> usage", over.code === "usage", over);
    over = await A.ask("#creategroup " + "g".repeat(33), m => m.type === "error");
    ok("a 33-char group name -> usage", over.code === "usage", over);
    over = await A.ask(`#react 5 ${"e".repeat(33)}`, m => m.type === "error");
    ok("a 33-byte emoji argument -> usage", over.code === "usage", over);
    over = await A.ask(`#delete ${"9".repeat(19)}`, m => m.type === "error");
    ok("a 19-digit id -> usage (no bignum surprises)", over.code === "usage", over);
    ack = await A.ask(`#delete ${"9".repeat(18)}`, m => m.type === "delete_denied" || m.type === "error");
    ok("an 18-digit id is accepted and simply not found", ack.type === "delete_denied", ack);

    console.log("=== Unusual but valid input ===");
    const u = "héllo wörld 👍 日本語";
    const heard = B.fresh(m => m.type === "private" && m.text === u);
    await A.ask(`#dm ${B.name} ${u}`, m => m.type === "dm_ack");
    ok("unicode message text round-trips through #dm byte-for-byte", !!(await heard));
    const many = await A.ask(`#dm    ${B.name}      lots     of   spaces`, m => m.type === "dm_ack");
    ok("runs of spaces between arguments are fine", many.type === "dm_ack");
    const heard2 = B.fresh(m => m.type === "private" && m.text === "keep    inner   spacing");
    await A.ask(`#dm ${B.name} keep    inner   spacing`, m => m.type === "dm_ack");
    ok("...and spaces INSIDE the message text are preserved", !!(await heard2));
    const nl = B.fresh(m => m.type === "private" && m.text === "line1\nline2");
    await A.ask(`#dm ${B.name} line1\nline2`, m => m.type === "dm_ack");
    ok("a multi-line message survives #dm", !!(await nl));
    const tabbed = await A.ask(`#dm ${B.name}\thello`, m => m.type === "error" || m.type === "dm_ack");
    ok("a TAB right after the username is not treated as a separator (usage error)", tabbed.type === "error" && tabbed.code === "usage", tabbed);
    ok("uppercase command names work (#DM)", (await A.ask(`#DM ${B.name} shout`, m => m.type === "dm_ack")).type === "dm_ack");
    ok("#help with a leading # or caps", (await A.ask("#HELP #DM", m => m.type === "cmd_help")).command.name === "dm");
    const dash = await A.ask("#-", m => m.type === "error" || m.type === "own_message_id");
    ok("'#-' (non-letter after #) is plain chat text (posted), not a command", dash.type === "own_message_id", dash);
    const lone = await A.ask("#a", m => m.type === "error");
    ok("'#a' (a letter, no such command) -> unknown_command", lone.code === "unknown_command", lone);
    const hyph = await A.ask("#admin-", m => m.type === "error");
    ok("'#admin-' -> unknown_command with admin-* suggestions", hyph.code === "unknown_command" && hyph.suggestions.some(s => s.startsWith("admin-")), hyph);

    console.log("=== Suggestions: ordering, caps, exclusions, argument types ===");
    let c = await A.complete("#");
    ok("bare '#' lists commands (capped at 25)", c.kind === "command" && c.items.length === 25, c.items.length);
    c = await A.complete("#re");
    const names = c.items.map(i => i.value);
    ok("'#re' matches by prefix on names and aliases", ["reply", "replydm", "replygroup", "react", "reactdm", "reactgroup", "read", "reject", "requests", "remind"].every(n => names.includes(n)), names);
    c = await A.complete("#RE");
    ok("suggestions are case-insensitive", c.items.length === names.length);
    c = await A.complete("#zzzz");
    ok("no matches -> empty items", c.kind === "command" && c.items.length === 0, c);
    c = await A.complete("#dm  ");
    ok("extra spaces after the command still address argument 0", c.kind === "arg" && c.arg.index === 0, c);
    c = await A.complete("#creategroup ");
    ok("free-form name argument: no candidates", c.kind === "arg" && c.items.length === 0 && c.arg.type === "group", c);
    c = await A.complete("#historyhost ");
    ok("host argument: none configured -> empty (fixed AI hosts aren't routable)", c.kind === "arg" && c.arg.type === "host" && c.items.length === 0, c);
    c = await A.complete("#react 5 ");
    ok("emoji argument: no candidates", c.kind === "arg" && c.arg.type === "emoji" && c.items.length === 0, c);
    c = await A.complete("#delete ");
    ok("message-id argument: no candidates, type reported", c.kind === "arg" && c.arg.type === "msgid" && c.items.length === 0, c);
    c = await A.complete("#status hello wor");
    ok("free text argument -> kind text", c.kind === "text", c);
    c = await A.complete("#requests ");
    ok("enum argument lists its values", c.kind === "arg" && c.items.length === 5, c.items);
    c = await A.complete("#requests PE");
    ok("enum suggestion is case-insensitive", c.items.map(i => i.value).join() === "pending", c.items);
    c = await A.complete("#requests p");
    ok("enum: prefix match ranks before substring match ('p' -> pending, then accepted)", c.items.map(i => i.value).join() === "pending,accepted", c.items);
    c = await A.complete("#nosuch anything");
    ok("unknown command -> none", c.kind === "none", c);

    // users: prefix first, then substring; self excluded; cap of 10
    const crowd = [];
    for (let i = 0; i < 12; i++) crowd.push(await new Client(`zq${String(i).padStart(2, "0")}_${sfx}`).login());
    const inner = await new Client(`a_zq_${sfx}`).login();     // substring match, not a prefix
    c = await A.complete("#dm zq");
    ok("12 prefix matches are capped at 10", c.items.length === 10, c.items.length);
    ok("...alphabetical, all prefix matches first", c.items.every(i => i.value.startsWith("zq")) && c.items.map(i => i.value).join() === [...c.items.map(i => i.value)].sort().join(), c.items.map(i => i.value));
    c = await A.complete(`#dm ${sfx.toString().slice(0, 4)}`);
    ok("a substring-only match still shows up when there is room", c.items.some(i => i.value.includes(String(sfx).slice(0, 4))), c.items);
    c = await A.complete(`#dm a_zq`);
    ok("substring vs prefix: 'a_zq' finds the prefix match", c.items.map(i => i.value).includes(`a_zq_${sfx}`), c.items);
    c = await A.complete(`#dm zq00_`);
    ok("narrowing to one", c.items.length === 1 && c.items[0].value === `zq00_${sfx}`, c.items);
    c = await A.complete(`#dm ${A.name}`);
    ok("you never see yourself in user suggestions", !c.items.some(i => i.value === A.name), c.items);
    const ordered = await A.complete("#dm zq0");
    ok("substring hits rank after prefix hits", ordered.items.slice(0, 10).every(i => i.value.startsWith("zq0")), ordered.items.map(i => i.value));
    c = await A.complete("#dm zq00_" + sfx + " ");
    ok("after a complete username, the next argument is the text", c.kind === "text", c);
    for (const x of [...crowd, inner]) x.close();
    await sleep(300);
    c = await A.complete("#dm zq");
    ok("a user who disconnects drops out of suggestions", c.items.length === 0, c.items);

    // groups: only the caller's own groups
    const gname = `edgegrp${sfx}`;
    await A.ask(`#creategroup ${gname}`, m => m.type === "group_created");
    await A.ask(`#creategroup other${gname}`, m => m.type === "group_created");
    c = await A.complete("#groupmsg edge");
    ok("group suggestions list your groups, prefix match first, with member counts", c.items.length === 2 && c.items[0].value === gname && /1 members/.test(c.items[0].hint), c.items);
    c = await B.complete("#groupmsg edge");
    ok("...and a non-member sees none of them (no leaking group names)", c.items.length === 0, c.items);
    c = await A.complete("#leavegroup ");
    ok("#leavegroup <group> suggests all of yours", c.items.length === 2, c.items);

    console.log("=== Concurrent burst ===");
    const N = 40;
    const crowd2 = await Promise.all(Array.from({ length: N }, (_, i) => new Client(`bx${i}_${sfx}`).login()));
    const t0 = Date.now();
    const results = await Promise.all(crowd2.map(async (cl, i) => {
        const peer = crowd2[(i + 1) % N];
        const out = [];
        for (let k = 0; k < 8; k++) {
            out.push(cl.ask(`#dm ${peer.name} msg ${i}-${k}`, m => m.type === "dm_ack" && m.with === peer.name, 15000));
            out.push(cl.complete(`#dm bx${(i + k) % N}`));
            out.push(cl.ask("#users", m => m.type === "users", 15000));
        }
        return Promise.allSettled(out);
    }));
    const settled = results.flat();
    const bad2 = settled.filter(r => r.status !== "fulfilled");
    ok(`${N} clients x 24 mixed #commands/suggestions each: every request answered (${settled.length} total, ${Date.now() - t0} ms)`, bad2.length === 0, bad2.slice(0, 3).map(r => r.reason?.message));
    const alive = await A.ask("#users", m => m.type === "users");
    ok("the server still answers afterwards, with all clients listed", crowd2.every(x => alive.list.includes(x.name)), alive.list.length);
    const t1 = Date.now();
    await A.ask("/cmds", m => m.type === "cmd_catalog");
    ok(`the catalog is still quick under a warm server (${Date.now() - t1} ms)`, Date.now() - t1 < 500);
    const sizeKB = JSON.stringify((await A.ask("/cmds", m => m.type === "cmd_catalog"))).length / 1024;
    ok(`catalog size is modest (${sizeKB.toFixed(1)} KB; the docs say ~15 KB)`, sizeKB < 60, sizeKB);
    crowd2.forEach(x => x.close());

    A.close(); B.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
    process.exit(0);
}

main().catch(e => { console.error("Test run crashed:", e); process.exit(2); });
