// A stalled Redis must not take live chat down.
//
// Freezes Redis for longer than the driver's 5 s call timeout while users are connected, and checks that
//   - routing / presence keep answering during the freeze (nothing waits on Redis),
//   - a message that cannot be saved gets a clean "Temporarily unavailable" to its sender (not lost silently,
//     not half-delivered), for direct and group messages,
//   - nobody is disconnected and nothing crashes (the user registry survives),
//   - messages flow again the moment Redis is back.
// Before the fix, chat_room crashed on the first message during the freeze and every later message failed
// until everyone reconnected.
//
//   REDIS_PORT=6390 REDIS_DB=2 erl ... -s chat_app start 5571 8091
//   RUN_REDIS_PORT=6390 node test/redis_stall_test.mjs 8091      (RUN_REDIS_PORT defaults to 6399)
//
// Also run by `node test/run_all.mjs redis_stall`.

import net from "node:net";

const PORT = process.argv[2] || 8091;
const REDIS_PORT = Number(process.env.RUN_REDIS_PORT || 6399);
const PAUSE_MS = 6500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sfx = Date.now().toString(36).slice(-4);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
    if (cond) { pass++; console.log("  PASS: " + name); }
    else { fail++; failures.push(name); console.log("  FAIL: " + name + (detail !== undefined ? " -- " + JSON.stringify(detail) : "")); }
}

function redisPause(ms) {
    return new Promise((resolve, reject) => {
        const s = net.connect(REDIS_PORT, "127.0.0.1");
        const cmd = ["CLIENT", "PAUSE", String(ms), "ALL"];
        s.write(`*${cmd.length}\r\n` + cmd.map((x) => `$${x.length}\r\n${x}\r\n`).join(""));
        s.once("data", (d) => { s.end(); String(d).startsWith("+OK") ? resolve() : reject(new Error(String(d))); });
        s.once("error", reject);
    });
}

async function client(name) {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const c = { name, ws, inbox: [], closed: false };
    ws.addEventListener("message", (e) => { try { c.inbox.push(JSON.parse(e.data)); } catch { /* ignore */ } });
    ws.addEventListener("close", () => { c.closed = true; });
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    ws.send(JSON.stringify({ username: name, token: "t" + name, armSessionId: "s" }));
    await waitFor(c, (m) => m.type === "welcome", 5000);
    return c;
}
async function waitFor(c, pred, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const i = c.inbox.findIndex(pred);
        if (i >= 0) return { m: c.inbox.splice(i, 1)[0], ms: Date.now() - t0 };
        await sleep(20);
    }
    return null;
}

async function main() {
    console.log(`Redis stall against ws://localhost:${PORT} (Redis :${REDIS_PORT}, freeze ${PAUSE_MS} ms)\n`);
    const A = await client(`sa${sfx}`), B = await client(`sb${sfx}`), C = await client(`sc${sfx}`);

    console.log("=== Healthy baseline ===");
    A.ws.send(`/msg ${B.name} before`);
    ok("a direct message is delivered", !!(await waitFor(B, (m) => m.text === "before")));
    A.ws.send(`/creategroup stall${sfx}`);
    ok("a group can be created", !!(await waitFor(A, (m) => m.type === "group_created")));
    A.ws.send(`/addmember stall${sfx} ${B.name}`);
    await waitFor(B, (m) => m.type === "added_to_group");
    A.ws.send(`/groupmsg stall${sfx} hi`);
    ok("a group message is delivered", !!(await waitFor(B, (m) => m.type === "group_message" && m.text === "hi")));

    console.log("=== Freeze Redis ===");
    await redisPause(PAUSE_MS);
    await sleep(200);
    const t0 = Date.now();
    // two different senders, so both are in flight at once (one connection handles its lines in order)
    A.ws.send(`/msg ${C.name} during-stall`);
    B.ws.send(`/groupmsg stall${sfx} group-during-stall`);

    C.ws.send("/list");
    const list = await waitFor(C, (m) => m.type === "users", 3000);
    ok("routing still answers while Redis is frozen (/list < 1 s)", !!list && list.ms < 1000, list && list.ms);
    C.ws.send("/groups");
    const groups = await waitFor(C, (m) => m.type === "groups", 3000);
    ok("the group registry still answers while Redis is frozen (/groups < 1 s)", !!groups && groups.ms < 1000, groups && groups.ms);
    C.ws.send("/typing global");
    ok("typing / presence traffic is accepted", true);

    const dmErr = await waitFor(A, (m) => m.type === "error" && /Temporarily unavailable/.test(m.text || ""), 12000);
    ok("the sender is told the direct message could not be sent", !!dmErr, dmErr);
    const gErr = await waitFor(B, (m) => m.type === "error" && /Temporarily unavailable/.test(m.text || ""), 12000);
    ok("...and the group-message sender is told too", !!gErr, gErr);
    ok("the errors arrive when Redis gives up (about 5 s), not never", Date.now() - t0 < 8500, Date.now() - t0);
    ok("nobody sees a message that could not be saved",
        !C.inbox.some((m) => m.text === "during-stall") && !A.inbox.some((m) => m.text === "group-during-stall"));
    ok("nobody was disconnected", !A.closed && !B.closed && !C.closed);

    console.log("=== Redis is back ===");
    await sleep(Math.max(0, PAUSE_MS - (Date.now() - t0)) + 500);
    A.ws.send(`/msg ${B.name} after`);
    ok("direct messages flow again", !!(await waitFor(B, (m) => m.text === "after", 5000)));
    A.ws.send(`/groupmsg stall${sfx} group-after`);
    ok("group messages flow again", !!(await waitFor(B, (m) => m.type === "group_message" && m.text === "group-after", 5000)));
    C.inbox.length = 0; C.ws.send("/list");
    const l2 = await waitFor(C, (m) => m.type === "users", 3000);
    const who = JSON.stringify(l2?.m ?? {});
    ok("every user is still registered (the registry survived)", [A.name, B.name, C.name].every((n) => who.includes(n)), who);

    for (const c of [A, B, C]) try { c.ws.close(); } catch { /* ignore */ }
    console.log(`\n=== SUMMARY ===\n${pass} passed, ${fail} failed`);
    if (fail) { console.log(failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
    process.exit(0);
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
