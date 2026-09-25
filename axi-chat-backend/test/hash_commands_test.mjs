// End-to-end test of the #command layer over a REAL WebSocket against a
// running axi-chat-backend (same setup as integration_test.mjs: server up,
// Redis reachable, Node 22+, no dependencies).
//
//   node test/hash_commands_test.mjs [port]
//   node test/hash_commands_test.mjs --url ws://<host>/ws
//
// Runs in the default SANDESH_MODE=open. Sandesh-backed commands (#cards,
// #accept, ...) are exercised here only as far as "no Sandesh session" goes;
// see sandesh_test.mjs for signed-in flows. The frontend contract these
// assertions pin down is written up in docs/HASH_COMMANDS.md.
//
// Note: this test deliberately floods the connection to check the rate
// limits, so run it against a dev/preview backend, not production.

let URL;
if (process.argv[2] === "--url") URL = process.argv[3];
else URL = `ws://localhost:${process.argv[2] || 8080}`;

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc + (detail ? ` -- ${detail}` : "")); console.log(`  FAIL: ${desc}${detail ? " -- " + detail : ""}`); }
}

class Client {
    constructor(name) {
        this.name = name; this.inbox = []; this.waiters = [];
        this.ws = new WebSocket(URL);
        this.opened.catch(() => {});
        this.ws.addEventListener("message", (ev) => {
            let msg; try { msg = JSON.parse(ev.data); } catch { msg = { type: "__raw__", text: ev.data }; }
            this.inbox.push(msg);
            for (let i = this.waiters.length - 1; i >= 0; i--) {
                if (this.waiters[i].pred(msg)) { this.waiters[i].resolve(msg); this.waiters.splice(i, 1); }
            }
        });
    }
    // Registered at construction: a socket can finish opening before login() is called.
    get opened() {
        this._opened ??= new Promise((res, rej) => {
            this.ws.addEventListener("open", res, { once: true });
            this.ws.addEventListener("error", rej, { once: true });
        });
        return this._opened;
    }
    async open() { await this.opened; }
    async login() {
        await this.open();
        this.send({ username: this.name, token: "tok-" + this.name });
        await this.waitFor(m => m.type === "welcome");
    }
    send(obj) { this.ws.send(typeof obj === "string" ? obj : JSON.stringify(obj)); }
    // Resolves with the next matching message that arrives AFTER this call.
    next(pred, ms = 3000, label = "message") {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
        });
    }
    waitFor(pred, ms = 3000, label = "message") {
        const hit = this.inbox.find(pred);
        return hit ? Promise.resolve(hit) : this.next(pred, ms, label);
    }
    // Sends a line and returns the first message matching pred that follows.
    async ask(line, pred, ms = 3000, label = line) {
        const p = this.next(pred, ms, label);
        this.send(line);
        return p;
    }
    // True if NO message matching pred shows up within ms.
    async silent(pred, ms = 600) {
        const before = this.inbox.length;
        await new Promise(r => setTimeout(r, ms));
        return !this.inbox.slice(before).some(pred);
    }
    close() { this.ws.close(); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`Testing #commands at ${URL}\n`);
    const sfx = Date.now() % 1e9;
    const A = new Client(`hcA${sfx}`), B = new Client(`hcB${sfx}`);
    await A.login(); await B.login();
    const group = `hcgrp${sfx}`;

    console.log("=== Catalog (/cmds) ===");
    const cat = await A.ask("/cmds", m => m.type === "cmd_catalog");
    ok("catalog lists many commands", cat.commands.length > 40, `${cat.commands.length}`);
    ok("catalog carries prefix and escape", cat.prefix === "#" && cat.escape === "##");
    const byName = Object.fromEntries(cat.commands.map(c => [c.name, c]));
    ok("dm is described with typed args", byName.dm?.args?.[0]?.type === "user" && byName.dm?.args?.[1]?.rest === true, JSON.stringify(byName.dm));
    ok("dm is available; Sandesh commands need sign-in here",
        byName.dm.available === true && byName.cards.available === false && byName.cards.requires === "signin");
    ok("every command has a category that exists",
        cat.commands.every(c => cat.categories.some(k => k.id === c.category)));
    const filtered = await A.ask("/cmds re", m => m.type === "cmd_catalog" && m.filter === "re");
    ok("/cmds <prefix> filters", filtered.commands.length > 0 && filtered.commands.every(c => [c.name, ...c.aliases].some(n => n.startsWith("re"))));

    console.log("=== Messaging ===");
    const users = await A.ask("#users", m => m.type === "users");
    ok("#users lists both clients", users.list.includes(A.name) && users.list.includes(B.name));

    const bGot = B.next(m => m.type === "private" && m.text === "hello via hash");
    const ack = await A.ask(`#dm ${B.name} hello via hash`, m => m.type === "dm_ack");
    ok("#dm delivers and acks", (await bGot).from === A.name && ack.with === B.name && ack.status === "delivered");

    const react = A.next(m => m.type === "dm_reaction" && m.messageId === ack.id);
    B.send(`#reactdm ${A.name} ${ack.id} :+1:`);
    ok("#reactdm reacts", (await react).reactions.some(r => r.user === B.name));

    const denied = await B.ask(`#deletedm ${A.name} ${ack.id}`, m => m.type === "delete_denied");
    ok("#deletedm by a non-author is still refused server-side", denied.reason === "forbidden");
    const gone = A.next(m => m.type === "dm_deleted" && m.messageId === ack.id);
    A.send(`#deletedm ${B.name} ${ack.id}`);
    ok("#deletedm by the author deletes", !!(await gone));

    const hist = await A.ask(`#historydm ${B.name}`, m => m.type === "history" && m.scope === "dm");
    ok("#historydm returns the thread", Array.isArray(hist.list));
    const inbox = await B.ask("#inbox", m => m.type === "conversations");
    ok("#inbox returns conversations", Array.isArray(inbox.list));

    const noUser = await A.ask("#dm nosuchuser_" + sfx + " hi", m => m.type === "error");
    ok("#dm to an unknown user reports it", /No such user/.test(noUser.text), noUser.text);

    const gAck = B.next(m => m.type === "chat" && m.text === "global hello");
    A.send("global hello");
    ok("plain text still broadcasts", (await gAck).from === A.name);

    console.log("=== Groups ===");
    const created = await A.ask(`#creategroup ${group}`, m => m.type === "group_created");
    ok("#creategroup creates", created.name === group);
    const added = B.next(m => m.type === "added_to_group" && m.name === group);
    A.send(`#addmember ${group} ${B.name}`);
    ok("#addmember adds B", (await added).by === A.name);
    const gm = await B.ask(`#groupmsg ${group} hi team`, m => m.type === "group_msg_ack");
    ok("#groupmsg acks", gm.group === group);
    const groups = await A.ask("#groups", m => m.type === "groups");
    ok("#groups lists it", groups.list.some(g => g.name === group));
    const left = await B.ask(`#leavegroup ${group}`, m => m.type === "left_group");
    ok("#leavegroup leaves", !!left);

    console.log("=== Profile ===");
    await A.ask("#status feeling hashy", m => m.type === "profile" && m.user === A.name).catch(() => null);
    const prof = await B.ask(`#profile ${A.name}`, m => m.type === "profile" && m.user === A.name);
    ok("#status then #profile round-trips", prof.status === "feeling hashy", JSON.stringify(prof));
    const badAvatar = await A.ask("#avatar javascript:alert(1)", m => m.type === "error");
    ok("#avatar rejects non-http URLs", badAvatar.code === "usage");

    console.log("=== Errors are replies, never chat ===");
    const unk = await A.ask("#nope", m => m.type === "error");
    ok("unknown command -> error with code", unk.code === "unknown_command", JSON.stringify(unk));
    const typo = await A.ask("#dmm", m => m.type === "error");
    ok("typo suggests the real command", typo.suggestions.includes("dm"), JSON.stringify(typo.suggestions));
    ok("nothing was broadcast to the room", await B.silent(m => m.type === "chat" && /^#(nope|dmm)/.test(m.text)));
    const use = await A.ask("#dm", m => m.type === "error" && m.code === "usage");
    ok("missing args -> usage with the usage string", use.usage === "#dm <user> <text...>" && use.command === "dm");
    const bad = await A.ask("#delete abc", m => m.type === "error");
    ok("non-numeric id is rejected", bad.code === "usage");

    const esc = B.next(m => m.type === "chat" && m.text === "#hashtag literal");
    A.send("##hashtag literal");
    ok("## posts a literal message starting with #", (await esc).from === A.name);
    const num = B.next(m => m.type === "chat" && m.text === "#1 priority");
    A.send("#1 priority");
    ok("# followed by a non-letter is ordinary chat", (await num).from === A.name);

    console.log("=== Injection attempts ===");
    A.send(`#historydm ${B.name}\n/sd admin.org.get`);
    const inj = await A.waitFor(m => m.type === "error" && m.code === "usage" && m.command === "historydm", 2000).catch(() => null);
    ok("a newline in an argument cannot smuggle a second command", !!inj);
    ok("...and no sd reply came back for it", await A.silent(m => m.type === "sd" && m.action === "admin.org.get"));
    const q = await A.ask(`#dm ${B.name} /quit`, m => m.type === "dm_ack");
    ok("'/quit' inside message text is just text", q.status === "delivered");
    ok("...and A is still connected", (await A.ask("#users", m => m.type === "users")).list.includes(A.name));

    console.log("=== Sandesh actions (no session in open mode) ===");
    const me = await A.ask("#me", m => m.type === "sd" && m.action === "me");
    ok("#me answers in the /sd envelope, echoing reqId '#me'", me.ok === true && me.reqId === "#me" && me.data.authenticated === false, JSON.stringify(me));
    const cards = await A.ask("#cards", m => m.type === "sd" && m.action === "cards.list");
    ok("#cards without a session -> unauthenticated", cards.ok === false && cards.error.code === "unauthenticated" && cards.reqId === "#cards", JSON.stringify(cards));
    const adm = await A.ask("#admin-users", m => m.type === "sd" && m.action === "admin.users.list");
    ok("#admin-users without a session is refused", adm.ok === false && adm.error.code === "unauthenticated");

    console.log("=== Help ===");
    const help = await A.ask("#help dm", m => m.type === "cmd_help");
    ok("#help <command> explains one", help.command.name === "dm");
    const helpAll = await A.ask("#help", m => m.type === "cmd_catalog");
    ok("#help lists everything", helpAll.commands.length === cat.commands.length);

    console.log("=== Autocomplete (/cmdcomplete) ===");
    const c1 = await A.ask('/cmdcomplete {"input":"#gr","reqId":"r1"}', m => m.type === "cmd_suggestions");
    ok("command-name suggestions, reqId echoed", c1.kind === "command" && c1.reqId === "r1" && c1.items.some(i => i.value === "groups"));
    const c2 = await A.ask(`/cmdcomplete {"input":"#dm ${B.name.slice(0, 6)}"}`, m => m.type === "cmd_suggestions");
    ok("user argument suggests online users", c2.kind === "arg" && c2.arg.type === "user" && c2.items.some(i => i.value === B.name), JSON.stringify(c2));
    ok("...and never suggests yourself", !c2.items.some(i => i.value === A.name));
    const c3 = await A.ask('/cmdcomplete {"input":"#dm "}', m => m.type === "cmd_suggestions");
    ok("trailing space moves to the first argument", c3.kind === "arg" && c3.arg.index === 0 && c3.token === "");
    const c4 = await A.ask(`/cmdcomplete {"input":"#dm ${B.name} "}`, m => m.type === "cmd_suggestions");
    ok("after the user, the message text has no suggestions", c4.kind === "text" && c4.items.length === 0);
    const c5 = await A.ask('/cmdcomplete {"input":"#markread p"}', m => m.type === "cmd_suggestions");
    ok("enum arguments suggest their values", c5.items.map(i => i.value).join() === "pending,personal,priority".split(",").sort().join() || c5.items.length >= 2, JSON.stringify(c5.items));
    const c6 = await A.ask("/cmdcomplete not-json", m => m.type === "error");
    ok("malformed /cmdcomplete -> usage error", c6.code === "usage");
    const g = await A.ask(`/cmdcomplete {"input":"#historygroup "}`, m => m.type === "cmd_suggestions");
    ok("group argument answers (may be empty)", g.kind === "arg" && Array.isArray(g.items));

    console.log("=== Rate limits ===");
    for (let i = 0; i < 100; i++) A.send('/cmdcomplete {"input":"#d"}');
    await sleep(500);
    const still = await A.ask("#users", m => m.type === "users", 3000).catch(() => null);
    ok("a burst of autocomplete does not use up the command budget", !!still);
    const flood = [];
    A.ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.type === "error" && /Too many commands/.test(m.text || "")) flood.push(m); });
    for (let i = 0; i < 60; i++) A.send("#users");
    await sleep(800);
    ok("a flood of real #commands is still rate limited", flood.length > 0, `${flood.length} refusals`);

    A.close(); B.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
    process.exit(0);
}

main().catch(e => { console.error("Test run crashed:", e); process.exit(2); });
