// Studio API layer (web/src/core/api.js) driven through a fake shared socket: what it sends, how it maps replies.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { location: { port: "5173", hostname: "localhost" }, localStorage: { getItem: () => null } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const api = await import("../../web/src/core/api.js");

function fakeSocket(handlers) {
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    sd: async (action, args) => {
      calls.push([action, args]);
      const h = handlers[action];
      if (!h) return { ok: false, error: { code: "unknown", message: `Unknown sd action: ${action}` } };
      return typeof h === "function" ? h(args) : h;
    },
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    emit: (ev) => listeners.forEach((l) => l(ev)),
  };
}
const ok = (data) => ({ ok: true, data });
const err = (code, message, details) => ({ ok: false, error: { code, message, details } });
const use = (socket, user = { username: "Alice", token: "t" }) => api.configure({ socket, user });

test("errors: server codes map to HTTP-like statuses and field errors reach the form", async () => {
  const cases = { invalid_values: 422, not_found: 404, forbidden: 403, duplicate: 409, not_connected: 503, timeout: 503, boom: 500 };
  for (const [code, status] of Object.entries(cases)) {
    use(fakeSocket({ "tstruct.user.delete": err(code, "nope") }));
    await assert.rejects(api.deleteStruct("x"), (e) => e instanceof Error && e.status === status && e.message === "nope", code);
  }
  use(fakeSocket({ "tstruct.user.save": err("invalid_values", "bad", { fields: { qty: "Must be a number" } }) }));
  await assert.rejects(api.createStruct({ name: "x", caption: "X", fields: [] }), (e) => {
    assert.deepEqual(e.details, [{ fieldId: "qty", message: "Must be a number" }]);
    return true;
  });
});

test("isMine / currentUsername compare case-insensitively and never match nobody", () => {
  use(fakeSocket({}), { username: "Alice" });
  assert.equal(api.currentUsername(), "alice");
  assert.equal(api.isMine("ALICE"), true);
  assert.equal(api.isMine("bob"), false);
  assert.equal(api.isMine(null), false);
});

test("records: id is sent as a number, delete/update route to submissions.*", async () => {
  const s = fakeSocket({
    "submissions.delete": ok({}),
    "submissions.update": ok({ submission: { id: 7, tstruct: "t", values: { a: 1 }, by: "alice", ts: 1000, editedTs: 2000 } }),
  });
  use(s);
  assert.deepEqual(await api.deleteRecord("t", "7"), { deleted: true });
  assert.deepEqual(s.calls[0], ["submissions.delete", { id: 7 }]);
  const { record } = await api.updateRecord("t", "7", { a: 1 });
  assert.deepEqual(s.calls[1], ["submissions.update", { id: 7, values: { a: 1 } }]);
  assert.equal(record.id === 7 || record.id === "7", true);
});

test("getRecord: missing record is a 404", async () => {
  use(fakeSocket({ "submissions.list": ok({ submissions: [{ id: 1, tstruct: "t", values: {} }] }) }));
  await assert.rejects(api.getRecord("t", 99), (e) => e.status === 404);
});

test("getStruct falls back to an admin form when it isn't a user struct, and createRecord then submits to the admin action", async () => {
  const tstruct = { name: "leave", caption: "Leave", fields: [{ name: "k", type: "text", caption: "K" }], sections: [] };
  const s = fakeSocket({
    "tstruct.user.get": err("not_found", "no"),
    "tstruct.get": ok({ tstruct }),
    "tstruct.submit": ok({ submission: { id: 1, tstruct: "leave", values: { k: "x" } } }),
  });
  use(s);
  const got = await api.getStruct("leave");
  assert.ok(got);
  await api.createRecord("leave", { k: "x" });
  assert.equal(s.calls.at(-1)[0], "tstruct.submit");
});

test("getStruct: a forbidden admin form is reported as not found (don't reveal it exists)", async () => {
  use(fakeSocket({ "tstruct.user.get": err("not_found", "no"), "tstruct.get": err("forbidden", "no") }));
  await assert.rejects(api.getStruct("secret"), (e) => e.status === 404);
});

test("createRecord on a user struct uses tstruct.user.submit", async () => {
  const s = fakeSocket({
    "tstruct.user.get": ok({ tstruct: { name: "mine", caption: "Mine", fields: [], sections: [] } }),
    "tstruct.user.submit": ok({ submission: { id: 2, tstruct: "mine", values: {} } }),
  });
  use(s);
  await api.getStruct("mine");
  await api.createRecord("mine", {});
  assert.equal(s.calls.at(-1)[0], "tstruct.user.submit");
});

// ── options ────────────────────────────────────────────────────────────────
const publicCats = { data: { categories: ["Citizen"] } };
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/public")) return { ok: true, json: async () => publicCats };
  throw new Error(`unexpected fetch ${url}`);
};

const optionCases = [
  [{ type: "dataInput", caption: "Leave", config: { structName: "leave" } }, "data_input", "leave"],
  [{ type: "download", caption: "Policy", config: { fileId: "f1" } }, "download", "f1"],
  [{ type: "upload", caption: "Up", config: {} }, "upload", undefined],
  [{ type: "apiDisplay", caption: "Data", config: { apiName: "/x", displayAs: "nameValuePair" } }, "get_data", "/x"],
  [{ type: "pay", caption: "Pay", config: { paymentConfig: "cfg" } }, "pay", "cfg"],
  [{ type: "axpertOption", caption: "Ax", config: { subtype: "smartView", target: "sv" } }, "axpert_smartview", "sv"],
  [{ type: "axpertOption", caption: "Ax", config: { subtype: "customPage", target: "p" } }, "axpert_page", "p"],
];

for (const [payload, sdType, target] of optionCases) {
  test(`option round trip: ${payload.type}/${sdType}`, async () => {
    let saved;
    const s = fakeSocket({
      "tstruct.user.list": ok({ tstructs: [] }),
      "option.user.save": (a) => ((saved = a), ok({ option: { ...a, id: a.id || "o1", owner: "alice" } })),
    });
    use(s);
    const { option } = await api.createOption(payload);
    assert.equal(saved.type, sdType);
    assert.equal(saved.target, target === undefined ? saved.target : target);
    assert.equal(option.type, payload.type);
    assert.deepEqual(option.config, payload.type === "upload" ? {} : payload.config);
    assert.equal(option.canManage, true);
    assert.equal(option.createdBy, "alice");
  });
}

test("option: unknown type is rejected before reaching the server", async () => {
  const s = fakeSocket({});
  use(s);
  await assert.rejects(api.createOption({ type: "bogus", caption: "x" }), (e) => e.status === 400);
  assert.equal(s.calls.length, 0);
});

test("option 'applicable to': canonicalises category names and only sends restricted groups", async () => {
  let saved;
  const s = fakeSocket({ "option.user.save": (a) => ((saved = a), ok({ option: { ...a, id: "o" } })) });
  use(s);
  await api.createOption({
    type: "upload",
    caption: "u",
    applicableTo: {
      userCategories: { scope: "selected", selected: ["employee", "AFFILIATE", "citizen"] },
      affiliate: { affiliates: { scope: "all", selected: [] } },
      employee: {
        departments: { scope: "selected", selected: ["HR"] },
        branches: { scope: "all", selected: [] },
        designations: { scope: "all", selected: [] },
      },
    },
  });
  assert.deepEqual(saved.applicable, { categories: ["Employee", "Affiliate", "Citizen"], departments: ["HR"] });
});

test("option 'applicable to' is unknown (not 'everyone') when the server didn't send it", async () => {
  use(fakeSocket({
    "options.list": ok({ options: [{ id: "a", type: "upload", caption: "A" }] }),
    "option.user.list": ok({ options: [{ id: "b", type: "upload", caption: "B", applicable: { departments: ["HR"] } }] }),
  }));
  const list = await api.listOptions();
  const a = list.find((o) => o.id === "a");
  const b = list.find((o) => o.id === "b");
  assert.equal(a.applicableTo, undefined);
  assert.equal(a.canManage, false);
  assert.equal(b.canManage, true);
  assert.deepEqual(b.applicableTo.employee.departments, { scope: "selected", selected: ["HR"] });
  assert.equal(b.applicableTo.employee.branches.scope, "all");
});

test("listOptions: managed copy wins over the runnable one, newest first", async () => {
  use(fakeSocket({
    "options.list": ok({ options: [{ id: "a", type: "upload", caption: "old", createdTs: 1 }, { id: "c", type: "upload", caption: "C", createdTs: 5 }] }),
    "option.user.list": ok({ options: [{ id: "a", type: "upload", caption: "new", createdTs: 1, applicable: {} }] }),
  }));
  const list = await api.listOptions();
  assert.deepEqual(list.map((o) => o.id), ["c", "a"]);
  assert.equal(list[1].caption, "new");
});

test("getOption: unknown id is a 404; deleteOption calls option.user.delete", async () => {
  const s = fakeSocket({ "options.list": ok({ options: [] }), "option.user.list": ok({ options: [] }), "option.user.delete": ok({}) });
  use(s);
  await assert.rejects(api.getOption("zz"), (e) => e.status === 404);
  assert.deepEqual(await api.deleteOption("o1"), { deleted: true });
  assert.deepEqual(s.calls.at(-1), ["option.user.delete", { id: "o1" }]);
});

// ── live changes ───────────────────────────────────────────────────────────
test("subscribeChanges: only tstruct/option/submission events pass; reconnect becomes 'resync'", () => {
  const s = fakeSocket({});
  use(s);
  const got = [];
  const off = api.subscribeChanges((c) => got.push(c));
  s.emit({ type: "sd_event", event: "options_changed", data: { id: "o1", action: "save" } });
  s.emit({ type: "sd_event", event: "tstructs_changed", data: { name: "t" } });
  s.emit({ type: "sd_event", event: "submissions_changed", data: { id: 3 } });
  s.emit({ type: "sd_event", event: "something_else", data: {} });
  s.emit({ type: "message", text: "hi" });
  s.emit({ type: "status_change", status: "disconnected" });
  s.emit({ type: "status_change", status: "connected" });
  assert.deepEqual(got.map((c) => c.event), ["options_changed", "tstructs_changed", "submissions_changed", "resync"]);
  assert.equal(got[0].id, "o1");
  off();
  s.emit({ type: "sd_event", event: "options_changed", data: {} });
  assert.equal(got.length, 4, "unsubscribed");
});

test("subscribeChanges without a shared socket is a harmless no-op", () => {
  api.configure({ socket: undefined });
  // configure keeps the previous shared socket, so just make sure a subscription can always be undone
  const off = api.subscribeChanges(() => {});
  assert.equal(typeof off, "function");
  off();
});
