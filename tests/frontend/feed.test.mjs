import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  location: { port: "5173", hostname: "localhost", protocol: "http:" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { sandeshApi } = await import("../../src/services/sandeshApi.js");
const { sandeshSocket } = await import("../../src/services/sandeshSocket.js");
const { formatTimeAgo, buildInitialRoleNotifications } = await import("../../src/features/emberChat/utils/roleNotifications.js");

test("formatTimeAgo formats epoch milliseconds into friendly relative times", () => {
  const now = Date.now();
  assert.equal(formatTimeAgo(now - 10 * 1000), "Just now");
  assert.equal(formatTimeAgo(now - 15 * 60 * 1000), "15m ago");
  assert.equal(formatTimeAgo(now - 2 * 3600 * 1000), "2h ago");
  assert.equal(formatTimeAgo(now - 24 * 3600 * 1000), "Yesterday");
  assert.equal(formatTimeAgo(now - 3 * 86400 * 1000), "3d ago");
  assert.equal(formatTimeAgo(null, "Recently"), "Recently");
  assert.equal(formatTimeAgo(undefined), "Just now");
});

test("buildInitialRoleNotifications returns empty array (no fake presets)", () => {
  assert.deepEqual(buildInitialRoleNotifications(), []);
  assert.deepEqual(buildInitialRoleNotifications({ role: "admin" }, [{ id: 1 }]), []);
});

test("sandeshApi feed methods construct requests accurately", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, opts) => {
    requests.push({ url, method: opts?.method || "GET", headers: opts?.headers, body: opts?.body ? JSON.parse(opts.body) : undefined });
    return {
      status: 200,
      text: async () => JSON.stringify({ ok: true, data: { status: "mocked" } }),
    };
  };

  try {
    // 1. getFeed with query params
    await sandeshApi.getFeed({ priority: "high", category: "messages", unreadOnly: true, limit: 20, before: 1700000000 }, "mock-token");
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /feed\?priority=high&category=messages&unreadOnly=true&limit=20&before=1700000000/);
    assert.equal(requests[0].headers.Authorization, "Bearer mock-token");

    // 2. getFeed without params
    await sandeshApi.getFeed({}, "mock-token");
    assert.match(requests[1].url, /feed$/);

    // 3. getFeedSummary
    await sandeshApi.getFeedSummary("mock-token");
    assert.match(requests[2].url, /feed\/summary$/);

    // 4. feedRead specific ids
    await sandeshApi.feedRead({ ids: ["item-1"], read: false }, "mock-token");
    assert.equal(requests[3].method, "POST");
    assert.match(requests[3].url, /feed\/read$/);
    assert.deepEqual(requests[3].body, { ids: ["item-1"], read: false });

    // 5. feedRead all
    await sandeshApi.feedRead({ all: true }, "mock-token");
    assert.deepEqual(requests[4].body, { all: true });

    // 6. feedResolve
    await sandeshApi.feedResolve("item-1", "mock-token");
    assert.match(requests[5].url, /feed\/resolve$/);
    assert.deepEqual(requests[5].body, { id: "item-1" });

    // 7. feedDismiss
    await sandeshApi.feedDismiss("item-1", "mock-token");
    assert.match(requests[6].url, /feed\/dismiss$/);
    assert.deepEqual(requests[6].body, { id: "item-1" });

    // 8. feedClear
    await sandeshApi.feedClear("mock-token");
    assert.match(requests[7].url, /feed\/clear$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sandeshSocket feed helpers route through sd()", async () => {
  let lastAction = null;
  let lastArgs = null;

  const originalSd = sandeshSocket.sd;
  sandeshSocket.sd = (action, args) => {
    lastAction = action;
    lastArgs = args;
    return Promise.resolve({ ok: true });
  };

  try {
    await sandeshSocket.feedList({ priority: "high" });
    assert.equal(lastAction, "feed.list");
    assert.deepEqual(lastArgs, { priority: "high" });

    await sandeshSocket.feedSummary();
    assert.equal(lastAction, "feed.summary");

    await sandeshSocket.feedRead({ ids: ["1"], read: true });
    assert.equal(lastAction, "feed.read");
    assert.deepEqual(lastArgs, { ids: ["1"], read: true });

    await sandeshSocket.feedResolve("item-9");
    assert.equal(lastAction, "feed.resolve");
    assert.deepEqual(lastArgs, { id: "item-9" });

    await sandeshSocket.feedDismiss("item-9");
    assert.equal(lastAction, "feed.dismiss");
    assert.deepEqual(lastArgs, { id: "item-9" });

    await sandeshSocket.feedClear();
    assert.equal(lastAction, "feed.clear");
  } finally {
    sandeshSocket.sd = originalSd;
  }
});
