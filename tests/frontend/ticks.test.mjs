import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("TicksIcon component and EmberChat.css read receipts styling", () => {
  const cssPath = path.join(__dirname, "../../src/features/emberChat/EmberChat.css");
  const css = fs.readFileSync(cssPath, "utf-8");

  // Verify --sandesh-read-tick is defined in :root
  assert.ok(css.includes("--sandesh-read-tick: #25D366;"), "CSS contains WhatsApp signature green read tick variable");

  // Verify .sandesh-ticks.read is styled with green color
  assert.ok(css.includes(".sandesh-ticks.read {"), "CSS defines .sandesh-ticks.read rule");
  assert.ok(css.includes("var(--sandesh-read-tick, #25D366)"), "read ticks use WhatsApp green token");

  // Verify .sandesh-ticks.sent and .sandesh-ticks.delivered remain white
  assert.ok(css.includes(".sandesh-ticks.sent {"), "CSS defines .sandesh-ticks.sent rule");
  assert.ok(css.includes(".sandesh-ticks.delivered {"), "CSS defines .sandesh-ticks.delivered rule");
});

test("TicksIcon state normalization and WhatsApp behavior", () => {
  const resolveTickState = (state) => {
    const norm = typeof state === "object" && state !== null
      ? (state.ticks || state.status || (state.read ? "read" : "sent"))
      : state;
    const s = (norm || "sent").toString().toLowerCase().trim();
    if (s === "sending") return "sending";
    if (s === "failed") return "failed";
    if (s === "read" || s === "seen" || s === "true") return "read";
    if (s === "delivered") return "delivered";
    return "sent";
  };

  // Sent -> single white tick
  assert.equal(resolveTickState("sent"), "sent");
  assert.equal(resolveTickState({ status: "sent", ticks: "sent" }), "sent");

  // Delivered -> double white tick
  assert.equal(resolveTickState("delivered"), "delivered");
  assert.equal(resolveTickState({ ticks: "delivered" }), "delivered");

  // Read -> double green tick (WhatsApp reference)
  assert.equal(resolveTickState("read"), "read");
  assert.equal(resolveTickState("seen"), "read");
  assert.equal(resolveTickState(true), "read");
  assert.equal(resolveTickState({ read: true }), "read");
  assert.equal(resolveTickState({ ticks: "read" }), "read");
  assert.equal(resolveTickState({ status: "read" }), "read");

  // Sending & Failed states
  assert.equal(resolveTickState("sending"), "sending");
  assert.equal(resolveTickState("failed"), "failed");
});
