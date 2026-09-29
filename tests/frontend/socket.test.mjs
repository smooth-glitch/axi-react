// sandeshSocket.sd(): request/reply matching over the WebSocket, and what callers see when things go wrong.
import test from "node:test";
import assert from "node:assert/strict";

class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWS.last = this;
  }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); }
  deliver(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
FakeWS.OPEN = 1;
globalThis.WebSocket = FakeWS;
globalThis.window = { location: { protocol: "http:", host: "localhost:5173", hostname: "localhost", port: "5173" }, setTimeout, clearTimeout };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { sandeshSocket: sock } = await import("../../src/services/sandeshSocket.js");

const connect = () => {
  sock.connect({ username: "alice", token: "tok", userId: "u1" });
  const ws = FakeWS.last;
  ws.open();
  return ws;
};
const lastReqId = (ws) => JSON.parse(ws.sent.at(-1).replace(/^\/sd \S+ /, "")).reqId;

test("sd() before connecting resolves not_connected instead of hanging or throwing", async () => {
  const r = await sock.sd("options.list");
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "not_connected");
});

test("sd() sends '/sd <action> {json}' with a reqId and resolves with the matching reply", async () => {
  const ws = connect();
  const p = sock.sd("tstruct.user.get", { name: "t" });
  assert.match(ws.sent.at(-1), /^\/sd tstruct\.user\.get \{/);
  const reqId = lastReqId(ws);
  assert.ok(reqId);
  ws.deliver({ type: "sd", reqId, ok: true, data: { hello: 1 } });
  assert.deepEqual(await p, { type: "sd", reqId, ok: true, data: { hello: 1 } });
});

test("concurrent sd() calls are matched by reqId even if replies arrive out of order", async () => {
  const ws = connect();
  const p1 = sock.sd("a");
  const id1 = lastReqId(ws);
  const p2 = sock.sd("b");
  const id2 = lastReqId(ws);
  assert.notEqual(id1, id2);
  ws.deliver({ type: "sd", reqId: id2, ok: true, data: { n: 2 } });
  ws.deliver({ type: "sd", reqId: id1, ok: false, error: { code: "forbidden", message: "no" } });
  assert.equal((await p2).data.n, 2);
  assert.equal((await p1).error.code, "forbidden");
});

test("replies to sd() calls are not broadcast to subscribers, but live events are", async () => {
  const ws = connect();
  const seen = [];
  const off = sock.subscribe((e) => seen.push(e));
  const p = sock.sd("x");
  ws.deliver({ type: "sd", reqId: lastReqId(ws), ok: true, data: {} });
  await p;
  assert.equal(seen.some((e) => e.type === "sd"), false);
  ws.deliver({ type: "sd_event", event: "options_changed", data: { id: "o" } });
  assert.equal(seen.some((e) => e.type === "sd_event" && e.event === "options_changed"), true);
  off();
});

test("sd() times out with a timeout error and forgets the request", async () => {
  connect();
  const r = await sock.sd("slow", {}, 20);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "timeout");
  assert.equal(sock.pendingSd.size, 0);
});

test("a late reply after a timeout is ignored quietly", async () => {
  const ws = connect();
  const p = sock.sd("slow", {}, 10);
  const reqId = lastReqId(ws);
  await p;
  assert.doesNotThrow(() => ws.deliver({ type: "sd", reqId, ok: true, data: {} }));
});

test("listener errors don't break other listeners", () => {
  const ws = connect();
  const seen = [];
  const bad = sock.subscribe(() => { throw new Error("boom"); });
  const good = sock.subscribe((e) => seen.push(e));
  const orig = console.error;
  console.error = () => {};
  try {
    ws.deliver({ type: "sd_event", event: "tstructs_changed", data: {} });
  } finally {
    console.error = orig;
  }
  assert.equal(seen.length >= 1, true);
  bad(); good();
});
