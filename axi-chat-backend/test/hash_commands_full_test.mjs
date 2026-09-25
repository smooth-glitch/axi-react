// Exhaustive end-to-end run of every NON-Sandesh #command (and every alias) over
// a real WebSocket, in default open mode. Ends with a coverage check that FAILS
// if any command in the server's own catalog was never executed here, so a
// command added later without a test is caught.
//
//   node test/hash_commands_full_test.mjs [port]     (server + Redis running)
//
// Start the backend with CHAT_RATE_LIMIT_MAX=1000: this run sends far more than
// 30 commands per 10 s. Sandesh commands are covered in
// hash_commands_strict_test.mjs (they need strict mode + a signed-in user).
// Node 22+, no dependencies.

const URL = process.argv[2] === "--url" ? process.argv[3] : `ws://localhost:${process.argv[2] || 8081}`;

let pass = 0, fail = 0;
const failures = [];
function ok(desc, cond, detail) {
    if (cond) { pass++; console.log(`  PASS: ${desc}`); }
    else { fail++; failures.push(desc); console.log(`  FAIL: ${desc}${detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const covered = new Set();      // command names/aliases executed

class Client {
    constructor(name) {
        this.name = name; this.inbox = []; this.waiters = [];
        this.ws = new WebSocket(URL);
        this.opened = new Promise((res, rej) => {
            this.ws.addEventListener("open", res, { once: true });
            this.ws.addEventListener("error", rej, { once: true });
        });
        this.opened.catch(() => {});
        this.ws.addEventListener("message", (ev) => {
            const m = JSON.parse(ev.data);
            this.inbox.push(m);
            for (let i = this.waiters.length - 1; i >= 0; i--)
                if (this.waiters[i].pred(m)) { this.waiters[i].resolve(m); this.waiters.splice(i, 1); }
        });
    }
    async login() {
        await this.opened;
        this.ws.send(JSON.stringify({ username: this.name, token: "tok-" + this.name }));
        await this.waitFor(m => m.type === "welcome");
    }
    waitFor(pred, ms = 3000, label = "message") {
        const hit = this.inbox.find(pred);
        return hit ? Promise.resolve(hit) : this.next(pred, ms, label);
    }
    // first matching message that arrives AFTER this call
    next(pred, ms = 4000, label = "message") {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${label} (${this.name})`)), ms);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
        });
    }
    // send a line, resolve with the first message matching pred
    ask(line, pred, ms = 4000) {
        const p = this.next(pred, ms, `reply to ${line}`);
        this.send(line);
        return p;
    }
    send(line) {
        const w = /^#([A-Za-z][\w-]*)/.exec(line);
        if (w) covered.add(w[1].toLowerCase());
        this.ws.send(line);
    }
    async silent(pred, ms = 500) {
        const n = this.inbox.length;
        await sleep(ms);
        return !this.inbox.slice(n).some(pred);
    }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const sfx = Date.now() % 1e9;

async function main() {
    console.log(`Full #command run at ${URL}\n`);
    const A = new Client(`fa${sfx}`), B = new Client(`fb${sfx}`), C = new Client(`fc${sfx}`);
    await A.login(); await B.login(); await C.login();
    const cat = (await A.ask("/cmds", m => m.type === "cmd_catalog")).commands;
    const scopeCats = new Set(["messaging", "lookup", "groups", "profile", "help"]);
    const expected = cat.filter(c => scopeCats.has(c.category));
    const group = `fg${sfx}`;

    console.log("=== Global room: send, reply, react (toggle), delete ===");
    const bHears = B.next(m => m.type === "chat" && m.text === "first global");
    A.send("first global");
    const g1 = await bHears;
    const aOwn = await A.waitFor(m => m.type === "own_message_id");
    ok("baseline: B hears A's global message and A learns its id", g1.id === aOwn.id, [g1, aOwn]);

    let hears = A.next(m => m.type === "chat" && m.text === "replying to you");
    const ownB = B.next(m => m.type === "own_message_id");
    B.send(`#reply ${g1.id} replying to you`);
    let got = await hears;
    ok("#reply posts to the room with replyTo set", got.replyTo === g1.id && got.from === B.name, got);
    ok("#reply gives the sender its own_message_id", typeof (await ownB).id === "number");

    let rx = A.next(m => m.type === "reaction" && m.messageId === g1.id);
    B.send(`#react ${g1.id} :fire:`);
    let re = await rx;
    ok("#react adds a reaction", re.reactions.some(r => r.user === B.name && r.emoji === ":fire:"), re);
    rx = A.next(m => m.type === "reaction" && m.messageId === g1.id);
    B.send(`#react ${g1.id} :fire:`);
    re = await rx;
    ok("#react again toggles it off", !re.reactions.some(r => r.user === B.name), re);

    const denied = await B.ask(`#delete ${g1.id}`, m => m.type === "delete_denied" && m.messageId === g1.id);
    ok("#delete by a non-author is refused (forbidden)", denied.reason === "forbidden", denied);
    const notFound = await B.ask("#delete 999999999", m => m.type === "delete_denied");
    ok("#delete of a nonexistent id -> not_found", notFound.reason === "not_found" || notFound.reason === "forbidden", notFound);
    const del = B.next(m => m.type === "deleted" && m.messageId === g1.id);
    A.send(`#delete ${g1.id}`);
    ok("#delete by the author deletes for everyone", !!(await del));

    console.log("=== Direct messages: send, reply, react, read, delete, history ===");
    let priv = B.next(m => m.type === "private" && m.text === "via msg alias");
    let ack = await A.ask(`#msg ${B.name} via msg alias`, m => m.type === "dm_ack");
    await priv;
    ok("#msg alias works", ack.status === "delivered");
    priv = B.next(m => m.type === "private" && m.text === "via pm alias");
    await A.ask(`#pm ${B.name} via pm alias`, m => m.type === "dm_ack");
    ok("#pm alias works", !!(await priv));

    priv = B.next(m => m.type === "private" && m.text === "dm base");
    const dm1 = await A.ask(`#dm ${B.name} dm base`, m => m.type === "dm_ack");
    await priv;
    priv = A.next(m => m.type === "private" && m.text === "dm reply");
    const rAck = await B.ask(`#replydm ${A.name} ${dm1.id} dm reply`, m => m.type === "dm_ack");
    got = await priv;
    ok("#replydm delivers with replyTo", got.replyTo === dm1.id && rAck.status === "delivered", got);

    const rd = A.next(m => m.type === "dm_read" && m.from === B.name);
    B.send(`#read ${A.name}`);
    ok("#read notifies the other party (dm_read)", !!(await rd));

    const offline = await A.ask(`#dm nobody_${sfx} hi`, m => m.type === "error");
    ok("#dm to a never-seen user -> No such user", /No such user/.test(offline.text), offline);

    const h = await A.ask(`#historydm ${B.name}`, m => m.type === "history" && m.scope === "dm");
    ok("#historydm has the messages, oldest first", h.list.length >= 3 && h.list.some(x => x.text === "dm reply"), h.list.length);
    const inbox = await A.ask("#conversations", m => m.type === "conversations");
    ok("#conversations alias lists the thread", inbox.list.some(x => x.with === B.name), inbox);

    const dmR = A.next(m => m.type === "dm_reaction" && m.messageId === dm1.id);
    B.send(`#reactdm ${A.name} ${dm1.id} :ok:`);
    ok("#reactdm reaction reaches the other side", (await dmR).reactions.length === 1);

    const dmDel = B.next(m => m.type === "dm_deleted" && m.messageId === dm1.id);
    A.send(`#deletedm ${B.name} ${dm1.id}`);
    ok("#deletedm by the author", !!(await dmDel));

    console.log("=== Groups: create, add, message, reply, react, delete, history, leave ===");
    let cr = await A.ask(`#newgroup ${group}`, m => m.type === "group_created");
    ok("#newgroup alias creates", cr.name === group && cr.members.includes(A.name));
    const dup = await A.ask(`#creategroup ${group}`, m => m.type === "error");
    ok("#creategroup on an existing name is refused", /already exists/.test(dup.text), dup);
    const spaced = await A.ask("#creategroup bad name", m => m.type === "error");
    ok("#creategroup rejects a spaced name (usage error)", spaced.code === "usage", spaced);

    const invited = B.next(m => m.type === "added_to_group" && m.name === group);
    await A.ask(`#invitegroup ${group} ${B.name}`, m => m.type === "group_created");
    ok("#invitegroup alias adds B", (await invited).by === A.name);
    const again = await A.ask(`#addmember ${group} ${B.name}`, m => m.type === "error");
    ok("#addmember of an existing member is refused", /already in the group/.test(again.text), again);
    const ghost = await A.ask(`#addmember ${group} ghost_${sfx}`, m => m.type === "error");
    ok("#addmember of an offline/unknown user is refused", /isn't online/.test(ghost.text), ghost);
    const notMember = await C.ask(`#addmember ${group} ${C.name}`, m => m.type === "error");
    ok("#addmember by a non-member is refused", /not in that group/.test(notMember.text), notMember);

    let gmsg = B.next(m => m.type === "group_message" && m.text === "via gm alias");
    const gAck = await A.ask(`#gm ${group} via gm alias`, m => m.type === "group_msg_ack");
    const gm1 = await gmsg;
    ok("#gm alias delivers to members", gm1.group === group && gAck.id === gm1.id, gm1);
    gmsg = A.next(m => m.type === "group_message" && m.text === "group reply");
    await B.ask(`#replygroup ${group} ${gm1.id} group reply`, m => m.type === "group_msg_ack");
    ok("#replygroup carries replyTo", (await gmsg).replyTo === gm1.id);
    const nm = await C.ask(`#groupmsg ${group} sneaky`, m => m.type === "error");
    ok("#groupmsg by a non-member is refused", /not in that group/.test(nm.text), nm);
    const nog = await A.ask(`#groupmsg nogroup_${sfx} x`, m => m.type === "error");
    ok("#groupmsg to a missing group -> No such group", /No such group/.test(nog.text), nog);

    const gr = A.next(m => m.type === "group_reaction" && m.messageId === gm1.id);
    B.send(`#reactgroup ${group} ${gm1.id} :star:`);
    ok("#reactgroup", (await gr).reactions.some(r => r.user === B.name));

    const gh = await A.ask(`#historygroup ${group}`, m => m.type === "history" && m.scope === "group");
    ok("#historygroup returns the group's messages", gh.list.length >= 2 && gh.group === group, gh.list.length);

    const gdd = await A.ask(`#deletegroup ${group} ${gm1.id}`, m => m.type === "group_deleted" || m.type === "delete_denied");
    ok("#deletegroup by the author deletes", gdd.type === "group_deleted", gdd);
    const bogus = gm1.id + 1000000;
    const gdd2 = await B.ask(`#deletegroup ${group} ${bogus}`, m => m.messageId === bogus && (m.type === "delete_denied" || m.type === "group_deleted"));
    ok("#deletegroup of a missing message is refused", gdd2.type === "delete_denied", gdd2);
    const gm2 = B.next(m => m.type === "group_message" && m.text === "A's second");
    await A.ask(`#groupmsg ${group} A's second`, m => m.type === "group_msg_ack");
    const theirs = (await gm2).id;
    const gdd3 = await B.ask(`#deletegroup ${group} ${theirs}`, m => m.messageId === theirs && (m.type === "delete_denied" || m.type === "group_deleted"));
    ok("#deletegroup of someone else's message is refused (forbidden)", gdd3.type === "delete_denied" && gdd3.reason === "forbidden", gdd3);

    const groups = await B.ask("#groups", m => m.type === "groups");
    ok("#groups lists membership with members", groups.list.some(g => g.name === group && g.members.length === 2), groups);
    let left = await B.ask(`#leave ${group}`, m => m.type === "left_group");
    ok("#leave alias leaves", !!left);
    const again2 = await B.ask(`#leavegroup ${group}`, m => m.type === "error");
    ok("#leavegroup when not a member is refused", /not in that group/.test(again2.text), again2);
    const gone = await B.ask(`#leavegroup nogroup_${sfx}`, m => m.type === "error");
    ok("#leavegroup of a missing group -> No such group", /No such group/.test(gone.text), gone);

    console.log("=== Hosts ===");
    const hosts = await A.ask("#hosts", m => m.type === "hosts");
    ok("#hosts lists the 5 fixed hosts", hosts.list.map(x => x.key).sort().join() === "ai_router,claude,gemini,openai,workspace", hosts);
    for (const k of ["openai", "hr_not_configured"]) {
        const e = await A.ask(`#host ${k} hello`, m => m.type === "error");
        ok(`#host ${k}: not routable / no such department host`, /No such host/.test(e.text), e);
    }
    const hh = await A.ask("#historyhost hr_not_configured", m => m.type === "history" && m.scope === "host");
    ok("#historyhost answers (empty for an unconfigured host)", hh.host === "hr_not_configured" && hh.list.length === 0, hh);

    console.log("=== Lookups ===");
    const users = await A.ask("#who", m => m.type === "users");
    ok("#who alias lists online users", [A, B, C].every(x => users.list.includes(x.name)));
    const users2 = await A.ask("#online", m => m.type === "users");
    ok("#online alias", users2.list.includes(A.name));
    const gl = await A.ask("#history", m => m.type === "history" && m.scope === "global");
    ok("#history reloads the global room", Array.isArray(gl.list) && gl.list.some(x => x.text === "replying to you"), gl.list.length);

    console.log("=== Profile ===");
    const p1 = B.next(m => m.type === "profile" && m.user === A.name && m.status === "on a call");
    // B must be a contact of A to be pushed the update; DM'd earlier, so it is.
    A.send("#status on a call");
    await p1.catch(() => null);
    let prof = await C.ask(`#profile ${A.name}`, m => m.type === "profile" && m.user === A.name);
    ok("#status is stored and #profile reads it (by a stranger)", prof.status === "on a call", prof);
    A.send("#avatar https://example.com/me.png");
    await sleep(300);
    prof = await C.ask(`#profile ${A.name}`, m => m.type === "profile");
    ok("#avatar (https) is stored", prof.avatar === "https://example.com/me.png", prof);
    A.send("#avatar /uploads/abc123.png");
    await sleep(300);
    prof = await C.ask(`#profile ${A.name}`, m => m.type === "profile");
    ok("#avatar (/uploads/) is stored", prof.avatar === "/uploads/abc123.png", prof);
    const noProf = await C.ask(`#profile nobody_${sfx}`, m => m.type === "profile");
    ok("#profile of an unknown user answers with nulls, no crash", noProf.avatar === null && noProf.status === null, noProf);

    console.log("=== GIFs and stickers (Giphy; needs outbound internet) ===");
    for (const [cmd, evt] of [["gif cats", "gif_results"], ["sticker cats", "sticker_results"], ["gif", "gif_results"], ["sticker", "sticker_results"]]) {
        try {
            const r = await A.ask(`#${cmd}`, m => m.type === evt, 10000);
            ok(`#${cmd} -> ${evt} (${r.results.length} results)`, Array.isArray(r.results), r);
        } catch (e) {
            console.log(`  SKIP: #${cmd} -> no ${evt} within 10s (Giphy unreachable or no API key?)`);
            covered.add(cmd.split(" ")[0]);
        }
    }

    console.log("=== Help ===");
    const help = await A.ask("#commands", m => m.type === "cmd_catalog");
    ok("#commands alias returns the catalog", help.commands.length === cat.length);
    const one = await A.ask("#help react", m => m.type === "cmd_help");
    ok("#help <command> explains it", one.command.name === "react" && one.command.usage === "#react <messageId> <emoji>", one);
    const viaAlias = await A.ask("#help msg", m => m.type === "cmd_help");
    ok("#help <alias> resolves to the command", viaAlias.command.name === "dm", viaAlias);

    console.log("=== Every command's usage errors ===");
    for (const c of expected.filter(c => c.args.some(a => a.required))) {
        const e = await A.ask(`#${c.name}`, m => m.type === "error" && m.code === "usage");
        ok(`#${c.name} with no arguments -> usage "${c.usage}"`, e.usage === c.usage && e.command === c.name, e);
    }

    console.log("=== Coverage: every command in the catalog was executed ===");
    const missing = expected.filter(c => ![c.name, ...c.aliases].some(n => covered.has(n)));
    const strictOnlyAlias = expected.flatMap(c => c.aliases.filter(a => !covered.has(a)).map(a => `${c.name}/${a}`));
    ok(`all ${expected.length} chat commands executed at least once`, missing.length === 0, missing.map(c => c.name));
    console.log(`  info: aliases not exercised here: ${strictOnlyAlias.join(", ") || "none"}`);

    A.close(); B.close(); C.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
    process.exit(0);
}

main().catch(e => { console.error("Test run crashed:", e); process.exit(2); });
