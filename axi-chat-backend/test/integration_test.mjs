// Full multi-client integration test, driven over a REAL WebSocket
// connection against a running axi-chat-backend instance -- not a
// module-level/unit test. Requires: the server already running (see
// README.md) and reachable at the given port, with a Redis instance it
// can reach. Uses only Node's built-in WebSocket (Node 22+), no deps.
//
// Usage:
//   node test/integration_test.mjs [port]        # default port 8080
//
// This is deliberately a plain script, not a test framework, so it's
// runnable with zero setup on any machine that already has Node --
// exactly what you want to hand someone taking over this codebase who
// needs to quickly confirm "did I break anything" after a change.
//
// What this does NOT cover (see docs/DEBUGGING.md for the full list):
// file uploads, GIF/sticker search (depends on Giphy's live API), the
// raw TCP dev listener, and anything involving more than 2 concurrent
// clients.

const PORT = process.argv[2] || 8080;
const URL = `ws://localhost:${PORT}`;

let passCount = 0, failCount = 0;
const failures = [];

function ok(desc, cond, detail) {
    if (cond) { passCount++; console.log(`  PASS: ${desc}`); }
    else { failCount++; failures.push(desc + (detail ? ` -- ${detail}` : "")); console.log(`  FAIL: ${desc}${detail ? " -- " + detail : ""}`); }
}

class Client {
    constructor(name) {
        this.name = name;
        this.inbox = [];
        this.waiters = [];
        this.ws = new WebSocket(URL);
        this.ws.addEventListener("message", (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { msg = { type: "__raw__", text: ev.data }; }
            this.inbox.push(msg);
            for (let i = this.waiters.length - 1; i >= 0; i--) {
                if (this.waiters[i].pred(msg)) {
                    this.waiters[i].resolve(msg);
                    this.waiters.splice(i, 1);
                }
            }
        });
    }
    async open() {
        await new Promise((res, rej) => {
            this.ws.addEventListener("open", res, { once: true });
            this.ws.addEventListener("error", rej, { once: true });
        });
    }
    send(obj) { this.ws.send(typeof obj === "string" ? obj : JSON.stringify(obj)); }
    async waitFor(pred, timeoutMs = 3000, label = "message") {
        const existing = this.inbox.find(pred);
        if (existing) return existing;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label} (client ${this.name})`)), timeoutMs);
            this.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
        });
    }
    close() { this.ws.close(); }
}

async function main() {
    console.log(`Testing backend at ${URL}\n`);

    console.log("=== Connect & handshake ===");
    const bad = new Client("bad");
    await bad.open();
    bad.send({ username: "nobody" }); // missing token/armSessionId
    const badResp = await bad.waitFor(m => m.type === "error", 2000, "handshake rejection");
    ok("malformed connect payload rejected", badResp.type === "error");
    bad.close();

    const tooLong = new Client("toolong");
    await tooLong.open();
    tooLong.send({ username: "x".repeat(30), token: "t", armSessionId: "s" });
    const tooLongResp = await tooLong.waitFor(m => m.type === "error", 2000, "username too long rejection");
    ok("over-length username rejected", /too long/i.test(tooLongResp.text), tooLongResp.text);
    tooLong.close();

    const suffix = Date.now();
    const nameA = `arjuntest${suffix}`, nameB = `gunntest${suffix}`;

    const arjun = new Client(nameA);
    await arjun.open();
    arjun.send({ username: nameA, token: "tok-a", armSessionId: "sess-a" });
    const welcomeA = await arjun.waitFor(m => m.type === "welcome");
    ok("client A gets welcome", welcomeA.name === nameA);
    const historyA = await arjun.waitFor(m => m.type === "history");
    ok("client A gets initial history event", historyA.scope === "global" && Array.isArray(historyA.list));

    const gunn = new Client(nameB);
    await gunn.open();
    gunn.send({ username: nameB, token: "tok-g", armSessionId: "sess-g" });
    await gunn.waitFor(m => m.type === "welcome");
    const joinSystemMsg = await arjun.waitFor(m => m.type === "system" && m.text.includes(`${nameB} has joined`), 2000, "join notice");
    ok("client A sees client B's join system message", !!joinSystemMsg);

    console.log("=== Directory ===");
    arjun.send("/list");
    const usersResp = await arjun.waitFor(m => m.type === "users");
    ok("/list includes both clients", usersResp.list.includes(nameA) && usersResp.list.includes(nameB), JSON.stringify(usersResp.list));

    arjun.send("/hosts");
    const hostsResp = await arjun.waitFor(m => m.type === "hosts");
    const hostKeys = hostsResp.list.map(h => h.key).sort();
    ok("/hosts returns exactly the 5 preconfigured hosts", JSON.stringify(hostKeys) === JSON.stringify(["ai_router", "claude", "gemini", "openai", "workspace"]), JSON.stringify(hostKeys));

    console.log("=== DM ===");
    arjun.send(`/msg ${nameB} hello from A`);
    const dmAck = await arjun.waitFor(m => m.type === "dm_ack");
    ok("dm_ack has id and ts", typeof dmAck.id === "number" && typeof dmAck.ts === "number", JSON.stringify(dmAck));
    const dmReceived = await gunn.waitFor(m => m.type === "private");
    ok("client B receives the DM with matching text/id/ts", dmReceived.text === "hello from A" && dmReceived.id === dmAck.id && dmReceived.ts === dmAck.ts, JSON.stringify(dmReceived));

    arjun.send(`/history dm ${nameB}`);
    const dmHistory = await arjun.waitFor(m => m.type === "history" && m.scope === "dm");
    ok("dm history contains the sent message", dmHistory.list.some(m => m.id === dmAck.id && m.text === "hello from A"), JSON.stringify(dmHistory.list));

    console.log("=== Reactions & delete ===");
    gunn.send(`/react dm ${nameA} ${dmAck.id} :thumbsup:`);
    const reactionOnArjun = await arjun.waitFor(m => m.type === "dm_reaction" && m.messageId === dmAck.id);
    ok("dm_reaction reaches client A", reactionOnArjun.reactions.some(r => r.user === nameB), JSON.stringify(reactionOnArjun));
    const reactionOnGunn = await gunn.waitFor(m => m.type === "dm_reaction" && m.messageId === dmAck.id);
    ok("dm_reaction also echoes back to client B (the reactor)", reactionOnGunn.reactions.some(r => r.user === nameB));

    gunn.send(`/delete dm ${nameA} ${dmAck.id}`);
    const denied = await gunn.waitFor(m => m.type === "delete_denied" && m.messageId === dmAck.id, 2000, "delete_denied");
    ok("non-owner delete attempt gets explicit delete_denied feedback", denied.reason === "forbidden", JSON.stringify(denied));

    arjun.send(`/delete dm ${nameB} ${dmAck.id}`);
    const deletedEvt = await Promise.race([
        arjun.waitFor(m => m.type === "dm_deleted" && m.messageId === dmAck.id, 2000, "dm_deleted"),
        gunn.waitFor(m => m.type === "dm_deleted" && m.messageId === dmAck.id, 2000, "dm_deleted"),
    ]);
    ok("owner delete succeeds and pushes dm_deleted", !!deletedEvt);

    console.log("=== Host messaging (department hosts unconfigured, LLM/workspace must NOT be routable) ===");
    for (const key of ["openai", "ai_router", "claude", "gemini", "workspace"]) {
        arjun.send(`/hostmsg ${key} test`);
        const resp = await arjun.waitFor(m => m.type === "error" && m.text.includes(key), 2000, `hostmsg rejection for ${key}`);
        ok(`/hostmsg correctly refuses to route to preconfigured host "${key}"`, resp.text.includes("No such host"));
    }
    arjun.send("/hostmsg hr some message");
    const hrResp = await arjun.waitFor(m => m.type === "error" && m.text.includes("hr"));
    ok("/hostmsg to an unconfigured department host errors cleanly", hrResp.text.includes("No such host"));

    console.log("=== Groups ===");
    const groupName = `squadtest${suffix}`;
    gunn.send(`/creategroup ${groupName}`);
    const groupCreated = await gunn.waitFor(m => m.type === "group_created");
    ok("group created", groupCreated.name === groupName && groupCreated.members.includes(nameB));

    gunn.send(`/addmember ${groupName} ${nameA}`);
    const addedEvt = await arjun.waitFor(m => m.type === "added_to_group" && m.name === groupName);
    ok("client A notified of being added to group", addedEvt.members.includes(nameA) && addedEvt.members.includes(nameB));

    gunn.send(`/groupmsg ${groupName} hello squad`);
    const groupAck = await gunn.waitFor(m => m.type === "group_msg_ack");
    ok("group_msg_ack has id and ts", typeof groupAck.id === "number" && typeof groupAck.ts === "number");
    const groupMsgOnArjun = await arjun.waitFor(m => m.type === "group_message" && m.group === groupName);
    ok("client A receives the group message with matching id/ts", groupMsgOnArjun.id === groupAck.id && groupMsgOnArjun.ts === groupAck.ts);

    arjun.send("/groups");
    const groupsResp = await arjun.waitFor(m => m.type === "groups");
    ok("/groups lists the new group for client A", groupsResp.list.some(g => g.name === groupName));

    arjun.send(`/leavegroup ${groupName}`);
    const leftResp = await arjun.waitFor(m => m.type === "left_group");
    ok("leave group acknowledged", leftResp.text === groupName);
    gunn.send(`/leavegroup ${groupName}`); // clean up so this group doesn't linger in Redis

    console.log("=== Global broadcast & profile ===");
    gunn.send("plain broadcast message from client B");
    const chatMsgOnArjun = await arjun.waitFor(m => m.type === "chat" && m.text === "plain broadcast message from client B");
    ok("client A receives client B's global broadcast with ts", typeof chatMsgOnArjun.ts === "number");

    gunn.send("/setavatar https://example.com/avatar.png");
    const profileUpdate = await arjun.waitFor(m => m.type === "profile" && m.user === nameB);
    ok("avatar change broadcasts to client A", profileUpdate.avatar === "https://example.com/avatar.png");

    arjun.send(`/getprofile ${nameB}`);
    const profileResp = await arjun.waitFor(m => m.type === "profile" && m.user === nameB);
    ok("/getprofile returns client B's avatar", profileResp.avatar === "https://example.com/avatar.png");

    console.log("=== Message length guard ===");
    arjun.send(`/msg ${nameB} ${"x".repeat(2001)}`);
    const tooLongMsg = await arjun.waitFor(m => m.type === "error" && /too long/i.test(m.text));
    ok("over-length message rejected", !!tooLongMsg);

    console.log("\n=== SUMMARY ===");
    console.log(`${passCount} passed, ${failCount} failed`);
    if (failures.length) {
        console.log("Failures:");
        failures.forEach(f => console.log("  - " + f));
    }
    const code = failCount === 0 ? 0 : 1;
    // Close and give the async close handshake time to actually finish
    // before the process exits -- racing process.exit() against an
    // in-flight WebSocket close can hit a libuv assertion during teardown
    // on Windows (a Node/ws-on-Windows interaction, not anything server-
    // side). The test result itself is already printed above regardless
    // of what happens here.
    arjun.close();
    gunn.close();
    await new Promise(r => setTimeout(r, 300));
    process.exit(code);
}

main().catch(e => { console.error("TEST SCRIPT ERROR:", e); process.exit(2); });
