import test from "node:test";
import assert from "node:assert/strict";

// Setup browser globals before importing modules
class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    FakeWS.last = this;
  }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; }
  deliver(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
FakeWS.OPEN = 1;
globalThis.WebSocket = FakeWS;
globalThis.window = {
  location: { protocol: "http:", host: "localhost:5173", hostname: "localhost", port: "5173" },
  setTimeout,
  clearTimeout,
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { FRIENDLY_COMMAND_NAMES } = await import(
  "../../src/features/emberChat/data/hashCommandsCatalog.js"
);
const { sandeshSocket } = await import("../../src/services/sandeshSocket.js");
const { sandeshApi } = await import("../../src/services/sandeshApi.js");

test("FRIENDLY_COMMAND_NAMES matches exact specification", () => {
  const allowed = [
    "dm", "host", "groupmsg",
    "users", "hosts", "groups", "inbox", "profile",
    "creategroup", "addmember", "leavegroup",
    "me",
    "associates", "find", "connect", "disconnect", "requests", "accept", "reject",
    "remind",
    "help",
  ];

  // All allowed are in FRIENDLY_COMMAND_NAMES
  allowed.forEach((cmd) => {
    assert.ok(
      FRIENDLY_COMMAND_NAMES.has(cmd),
      `Expected ${cmd} to be in FRIENDLY_COMMAND_NAMES`
    );
  });

  // Removed commands must NOT be in FRIENDLY_COMMAND_NAMES
  const removed = [
    "gif", "sticker", "status", "avatar", "cards",
    "delete", "deletedm", "deletegroup",
    "react", "reactdm", "reactgroup",
    "read", "markread", "dismiss", "ignore", "myusers"
  ];
  removed.forEach((cmd) => {
    assert.ok(
      !FRIENDLY_COMMAND_NAMES.has(cmd),
      `Expected ${cmd} to NOT be in FRIENDLY_COMMAND_NAMES`
    );
  });
});

test("sandeshSocket reply and profile methods send expected slash commands", () => {
  sandeshSocket.connect({ username: "alice", token: "tok", userId: "u1" });
  const ws = FakeWS.last;
  ws.sent = [];

  sandeshSocket.sendReply(101, "Hello world");
  assert.equal(ws.sent.at(-1), "/reply 101 Hello world");

  sandeshSocket.sendReplyDM("bob", 102, "Direct reply");
  assert.equal(ws.sent.at(-1), "/replydm bob 102 Direct reply");

  sandeshSocket.sendReplyGroup("devs", 103, "Group reply");
  assert.equal(ws.sent.at(-1), "/replygroup devs 103 Group reply");

  sandeshSocket.sendSetAvatar("/uploads/alice.png");
  assert.equal(ws.sent.at(-1), "/setavatar /uploads/alice.png");

  sandeshSocket.sendGetProfile("bob");
  assert.equal(ws.sent.at(-1), "/getprofile bob");

  sandeshSocket.sendGifSearch("party");
  assert.equal(ws.sent.at(-1), "/gifsearch party");

  sandeshSocket.sendStickerSearch("smile");
  assert.equal(ws.sent.at(-1), "/stickersearch smile");
});

test("sandeshApi.uploadAvatar validates file before sending", async () => {
  // Test invalid file object
  await assert.rejects(
    () => sandeshApi.uploadAvatar(null),
    /No file selected/i
  );

  // Test non-image file
  const textFile = { type: "text/plain", size: 1000, name: "notes.txt" };
  await assert.rejects(
    () => sandeshApi.uploadAvatar(textFile),
    /Invalid image type/i
  );

  // Test oversized file (> 8 MB)
  const bigImage = { type: "image/png", size: 9 * 1024 * 1024, name: "huge.png" };
  await assert.rejects(
    () => sandeshApi.uploadAvatar(bigImage),
    /8 MB/i
  );
});
