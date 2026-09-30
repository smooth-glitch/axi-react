// The /sd lane: a slow or stuck /sd action must never freeze the user's connection.
//
// Uses the test-only actions test.sleep (an ordinary action) and test.slow_sleep (a slow one), which exist only
// when the backend runs with SANDESH_TEST_ACTIONS=1. SANDESH_SLOW_LIMIT_MS=1500 keeps the time-limit check quick.
//
//   REDIS_DB=1 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=100000 \
//   SANDESH_TEST_ACTIONS=1 SANDESH_SLOW_LIMIT_MS=1500 erl ... -s chat_app start 5573 8093
//   node test/sd_lane_test.mjs http://localhost:8093
//
// Also run by `node test/run_all.mjs sd_lane`.

import { suite, bootstrap, seedOrg, sleep, sfx } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8093";
const t = suite("sd_lane", BASE);
const { ok } = t;

async function main() {
    console.log(`The /sd lane against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const { A, connectUser } = B;
    const u1 = `lane${sfx}`, u2 = `peer${sfx}`;
    await seedOrg(A, [[u1, "Lane One", "Ops"], [u2, "Peer Two", "Ops"]]);
    const U = await connectUser(u1), P = await connectUser(u2);
    await U.sd("connect.scan", { code: (await P.sd("connect.my")).data.person.code });   // associates, so they may chat

    t.section("A stuck action does not freeze the connection");
    const t0 = Date.now();
    const slowId = U.fire("test.sleep", { ms: 1500 });
    U.send("/list");
    const list = await U.wait((m) => m.type === "users", 2000);
    const listMs = Date.now() - t0;
    ok("/list answers immediately while an ordinary /sd is still running", !!list && listMs < 400, listMs);
    U.send(`/msg ${u2} while-busy`);
    const ack = await U.wait((m) => m.type === "dm_ack", 2000);
    ok("a chat message is sent and acknowledged while an /sd is running", !!ack && Date.now() - t0 < 900, Date.now() - t0);
    const got = await P.wait((m) => m.text === "while-busy", 2000);
    ok("...and the other person receives it", !!got);
    U.send("/typing global");
    ok("typing traffic is accepted meanwhile", true);
    const slowReply = await U.waitReply(slowId, 4000);
    ok("the slow action's own reply still arrives, with its reqId", !!slowReply && slowReply.ok && slowReply.data.slept === 1500, slowReply);

    t.section("Replies keep the order the requests were sent (ordinary actions)");
    const ids = [];
    ids.push(U.fire("test.sleep", { ms: 400, n: 1 }));
    ids.push(U.fire("test.sleep", { ms: 10, n: 2 }));
    ids.push(U.fire("test.sleep", { ms: 200, n: 3 }));
    ids.push(U.fire("me"));
    const order = [];
    const t1 = Date.now();
    for (let i = 0; i < 4; i++) {
        const m = await U.wait((x) => x.type === "sd" && ids.includes(x.reqId), 4000);
        order.push(ids.indexOf(m.reqId));
    }
    ok("four requests, four replies, in order", order.join() === "0,1,2,3", order);
    ok("run one after another (about 600 ms of sleeping)", Date.now() - t1 >= 590, Date.now() - t1);

    t.section("Slow actions run in parallel, off the lane");
    const s0 = Date.now();
    const slow = [1, 2, 3].map((n) => U.fire("test.slow_sleep", { ms: 800, n }));
    const fast = U.fire("test.sleep", { ms: 0, n: "fast" });
    const fastReply = await U.waitReply(fast, 3000);
    ok("an ordinary action is not held up by slow ones", !!fastReply && fastReply.ok && Date.now() - s0 < 400, Date.now() - s0);
    const slowReplies = [];
    for (const id of slow) slowReplies.push(await U.waitReply(id, 4000));
    ok("three slow actions all succeed", slowReplies.every((r) => r && r.ok), slowReplies.map((r) => r?.ok));
    ok("...taking about one sleep, not three (they ran side by side)", Date.now() - s0 < 1900, Date.now() - s0);

    t.section("Limits: too many at once gets a clean 'busy'");
    const many = [];
    for (let n = 0; n < 6; n++) many.push(U.fire("test.slow_sleep", { ms: 700, n }));
    const results = [];
    for (const id of many) results.push(await U.waitReply(id, 6000));
    const busy = results.filter((r) => r && !r.ok && r.error.code === "busy");
    const done = results.filter((r) => r && r.ok);
    ok("only 4 slow actions run at once; the rest are told 'busy' immediately", done.length === 4 && busy.length === 2, { done: done.length, busy: busy.length });
    ok("a busy reply carries the request's reqId and a readable message", busy.every((r) => many.includes(r.reqId) && /wait a moment/.test(r.error.message)), busy);
    ok("after they finish the connection accepts slow actions again", (await U.sd("test.slow_sleep", { ms: 50 })).ok);

    t.section("A slow action that never finishes is stopped");
    const q0 = Date.now();
    const stuck = await U.sd("test.slow_sleep", { ms: 5000 }, 6000);
    ok("it is cut off at the time limit with a clear error, not left hanging", !stuck.ok && stuck.error.code === "timeout" && Date.now() - q0 < 3000, { stuck, ms: Date.now() - q0 });
    U.send("/list");
    ok("the connection is still fully usable after a timeout", !!(await U.wait((m) => m.type === "users", 2000)));
    ok("...and the counter was released (slow actions still work)", (await U.sd("test.slow_sleep", { ms: 20 })).ok);

    t.section("A backed-up lane is protected");
    const floodIds = [];
    floodIds.push(U.fire("test.sleep", { ms: 1500 }));
    for (let n = 0; n < 260; n++) floodIds.push(U.fire("test.sleep", { ms: 0, n }));
    await sleep(200);
    U.send("/list");
    const listWhileFlooded = await U.wait((m) => m.type === "users", 2000);
    ok("chat still answers while 260 actions are queued", !!listWhileFlooded);
    const replies = [];
    for (const id of floodIds) replies.push(await U.waitReply(id, 10000));
    const busy2 = replies.filter((r) => r && !r.ok && r.error.code === "busy").length;
    const okd = replies.filter((r) => r && r.ok).length;
    ok("at most 200 wait in the queue; the excess is refused with 'busy'", busy2 >= 55 && okd <= 205 && busy2 + okd === 261, { busy2, okd });
    ok("every request got exactly one reply", replies.every(Boolean) && new Set(replies.map((r) => r.reqId)).size === 261);

    t.section("Menu suggestions never block either");
    const c0 = Date.now();
    U.fire("test.sleep", { ms: 1200 });
    U.send("/cmdcomplete " + JSON.stringify({ input: "#", reqId: 77 }));
    const comp = await U.wait((m) => m.type === "cmd_suggestions" && m.reqId === 77, 2000);
    ok("the # menu answers while an /sd is running", !!comp && Date.now() - c0 < 500, Date.now() - c0);
    await sleep(1300);

    t.section("Connections are independent");
    const other = P.fire("test.sleep", { ms: 10 });
    const t2 = Date.now();
    U.fire("test.sleep", { ms: 1200 });
    const otherReply = await P.waitReply(other, 2000);
    ok("one user's busy lane doesn't slow another user", !!otherReply && Date.now() - t2 < 500, Date.now() - t2);

    t.section("Everything else behaves as before");
    ok("/sd me over the lane still works", (await U.sd("me")).ok);
    const bad = await U.sd("no.such.action");
    ok("unknown actions still give the usual unknown_action error", !bad.ok && bad.error.code === "unknown_action", bad);
    U.ws.send("/sd test.sleep {not json");
    const bj = await U.wait((m) => m.type === "sd" && m.error?.code === "bad_json", 2000);
    ok("bad JSON still gives bad_json", !!bj, bj);
    U.close();
    const gone = await P.sd("me");
    ok("closing one connection leaves others working", gone.ok);

    for (const c of [P, A]) c.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
