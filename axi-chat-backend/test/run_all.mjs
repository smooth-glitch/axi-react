#!/usr/bin/env node
// Runs EVERY backend test suite, each against its own fresh, isolated backend, and prints one summary.
//
//   cd axi-chat-backend && rebar3 compile        # once (the runner uses _build)
//   node test/run_all.mjs                        # everything
//   node test/run_all.mjs sandesh_test hash_     # only suites whose name contains one of these words
//
// What it does for you: starts a throwaway Redis (no persistence, on a spare port -- it never touches a real
// Redis or database 0), and for each suite flushes that suite's own logical DB, starts a new backend with the
// environment the suite documents in its header, waits until it answers, runs the suite, then stops the backend.
// Nothing is left running. Also runs the Erlang unit tests (`rebar3 eunit`).
//
// Needs on PATH: erl, redis-server, node 22+ (global WebSocket/fetch); rebar3 (or ./tools/rebar3) for eunit.
// Env overrides: RUN_REDIS_PORT (default 6399), RUN_BASE_PORT (default 18100), ERL, REDIS_SERVER.

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const ebin = path.join(backend, "_build", "default", "lib", "axi_chat_backend", "ebin");
const eredis = path.join(backend, "_build", "default", "lib", "eredis", "ebin");
const REDIS_PORT = Number(process.env.RUN_REDIS_PORT || 6399);
const BASE = Number(process.env.RUN_BASE_PORT || 18100);
const ERL = process.env.ERL || "erl";
const REDIS_SERVER = process.env.REDIS_SERVER || "redis-server";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the suites -----------------------------------------------------------------------------------------------
// db: the suite's own logical Redis DB (flushed first). env: the settings its header asks for.
// arg: how the suite takes its target ("url" = http://localhost:PORT, "port" = just the port, "ws" = ws://localhost:PORT).
const STRICT = { SANDESH_MODE: "strict" };
const SUITES = [
  { name: "sandesh_test", db: 13, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_SCHEDULER_TICK_MS: "500" } },
  { name: "sandesh_session_test", db: 10, arg: "url", env: { ...STRICT, SANDESH_SESSION_TTL_SEC: "6", SANDESH_SESSION_CHECK_SEC: "2" } },
  { name: "sandesh_mfa_test", db: 15, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_SCHEDULER_TICK_MS: "500", SANDESH_DEVICE_TRUST_SEC: "6" } },
  { name: "sandesh_totp_test", db: 14, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_SCHEDULER_TICK_MS: "500", SANDESH_TOTP_FRESH_SEC: "6", SANDESH_DEVICE_TRUST_SEC: "6" } },
  { name: "lite_tstruct_v2_test", db: 9, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_SCHEDULER_TICK_MS: "500" } },
  { name: "hash_commands_strict_test", db: 8, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "sandesh_feed_test", db: 11, arg: "url", timeoutMs: 120000, env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_SCHEDULER_TICK_MS: "500" } },
  { name: "options_categories_test", db: 4, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "connectum_codes_test", db: 3, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_PUBLIC_URL: "https://ent.example" } },
  // the /sd lane: test-only sleeping actions prove the connection is never blocked (SANDESH_TEST_ACTIONS is ignored in production)
  { name: "sd_lane_test", db: 1, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "100000", SANDESH_TEST_ACTIONS: "1", SANDESH_SLOW_LIMIT_MS: "1500" } },
  { name: "connectum_require_code_test", db: 16, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_REQUIRE_CODE: "1" } },
  { name: "connectum_people_test", db: 17, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "connectum_data_test", db: 18, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "100000", SANDESH_DS_TIMEOUT_MS: "1500" } },
  { name: "connectum_records_test", db: 19, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "connectum_catalog_test", db: 20, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "connectum_onboarding_test", db: 21, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "connectum_wizard_test", db: 22, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_FILES_DIR: path.join(os.tmpdir(), "sd-files-wizard") } },
  { name: "connectum_chat_test", db: 25, arg: "url", env: { CHAT_RATE_LIMIT_MAX: "1000", CHAT_EDIT_WINDOW_SEC: "3" } },
  { name: "connectum_cmdx_test", db: 24, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "connectum_option_run_test", db: 23, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "1000", SANDESH_PAY_WEBHOOK_SECRET: "whsecret-123" } },
  { name: "admin_reassign_test", db: 41, arg: "url", env: { ...STRICT, CHAT_RATE_LIMIT_MAX: "5000", SANDESH_OTP_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "12525", SMTP_USER: "mailer@test.co", SMTP_PASS: "pw", SMTP_STARTTLS: "0" } },
  { name: "backend_followups_test", db: 44, arg: "url", env: { CHAT_RATE_LIMIT_MAX: "20000" } },
  { name: "sec_impersonation_test", db: 5, arg: "url", env: { CHAT_RATE_LIMIT_MAX: "1000", SANDESH_REQUIRE_SESSION: "1" } },
  { name: "sandesh_user_options_test", db: 12, arg: "url", timeoutMs: 180000, env: { CHAT_RATE_LIMIT_MAX: "1000", SANDESH_MAX_FILE_MB: "1", SANDESH_FILES_DIR: path.join(os.tmpdir(), "sd-files-runall") } },
  // Open mode (the default). Two shared backends: the first two TEST the rate limiter so they need the default
  // limit; the other two send far more than it allows, so they need it raised.
  // Freezes Redis for ~6.5 s: needs its own backend (and Redis port, which it reads from RUN_REDIS_PORT).
  { name: "redis_stall_test", db: 2, arg: "port", timeoutMs: 60000, env: { CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "hash_commands_test", db: 7, arg: "port", group: "open-default", env: {} },
  { name: "integration_test", db: 7, arg: "port", group: "open-default", env: {} },
  { name: "hash_commands_edge_test", db: 6, arg: "port", group: "open-high", env: { CHAT_RATE_LIMIT_MAX: "1000" } },
  { name: "hash_commands_full_test", db: 6, arg: "port", group: "open-high", env: { CHAT_RATE_LIMIT_MAX: "1000" } },
];

// ---- tiny helpers ---------------------------------------------------------------------------------------------
function redisCmd(...args) {
  return new Promise((resolve, reject) => {
    const s = net.connect(REDIS_PORT, "127.0.0.1");
    const enc = (a) => `*${a.length}\r\n` + a.map((x) => `$${Buffer.byteLength(String(x))}\r\n${x}\r\n`).join("");
    let buf = "";
    s.on("connect", () => s.write(enc(args)));
    s.on("data", (d) => { buf += d; if (/\r\n$/.test(buf)) { s.end(); resolve(buf.trim()); } });
    s.on("error", reject);
    setTimeout(() => { s.destroy(); reject(new Error("redis timeout")); }, 3000);
  });
}
async function flushDb(n) {
  await redisCmd("SELECT", n).catch(() => {});
  // FLUSHDB applies to the connection's DB, so select and flush on ONE connection
  await new Promise((resolve, reject) => {
    const s = net.connect(REDIS_PORT, "127.0.0.1");
    let out = "";
    s.on("connect", () => s.write(`*2\r\n$6\r\nSELECT\r\n$${String(n).length}\r\n${n}\r\n*1\r\n$7\r\nFLUSHDB\r\n`));
    s.on("data", (d) => { out += d; if ((out.match(/\+OK/g) || []).length >= 2) { s.end(); resolve(); } });
    s.on("error", reject);
    setTimeout(() => { s.destroy(); reject(new Error("flush timeout")); }, 3000);
  });
}
async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { /* retry */ } await sleep(200); }
  throw new Error(`timed out waiting for ${what}`);
}
const httpUp = (port) => async () => (await fetch(`http://localhost:${port}/api/sd/public`)).ok;

function startBackend(port, db, env) {
  const child = spawn(ERL, ["-noshell", "-pa", ebin, "-pa", eredis, "-s", "chat_app", "start", String(port + 1000), String(port)], {
    cwd: backend,
    env: { ...process.env, REDIS_HOST: "127.0.0.1", REDIS_PORT: String(REDIS_PORT), REDIS_DB: String(db), SANDESH_DEV_OTP: "1", SANDESH_OTP_COOLDOWN_SEC: "0", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  child.getErr = () => err;
  return child;
}
const stop = (child) => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once("exit", resolve); child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000); });

function runNode(file, target, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, file + ".mjs"), target], { cwd: backend, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; if (process.env.RUN_ALL_TEE) fs.appendFileSync(process.env.RUN_ALL_TEE, d); });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { out += "\n[run_all] TIMED OUT\n"; child.kill("SIGKILL"); }, timeoutMs);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// Pulls "N passed, M failed" (or "N/M passed") out of a suite's output.
function summarize(out) {
  let m = out.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i);
  if (m) return { pass: +m[1], fail: +m[2] };
  m = out.match(/(\d+)\s*\/\s*(\d+)\s+(?:checks\s+)?passed/i);
  if (m) return { pass: +m[1], fail: +m[2] - +m[1] };
  const p = (out.match(/^\s*(?:PASS|✓|ok)\b/gim) || []).length;
  const f = (out.match(/^\s*(?:FAIL|✗|not ok)\b/gim) || []).length;
  return p || f ? { pass: p, fail: f } : null;
}

// ---- main -----------------------------------------------------------------------------------------------------
async function main() {
  const only = process.argv.slice(2);
  const wanted = (n) => only.length === 0 || only.some((w) => n.includes(w));
  if (!fs.existsSync(path.join(ebin, "chat_app.beam"))) {
    console.error(`No compiled backend at ${ebin}. Run \`rebar3 compile\` in axi-chat-backend first.`);
    process.exit(2);
  }
  fs.rmSync(path.join(os.tmpdir(), "sd-files-runall"), { recursive: true, force: true });

  const redis = spawn(REDIS_SERVER, ["--port", String(REDIS_PORT), "--save", "", "--appendonly", "no", "--bind", "127.0.0.1", "--databases", "64"], { stdio: "ignore" });
  const results = [];
  let port = BASE;
  try {
    await waitFor(async () => (await redisCmd("PING")) === "+PONG", 8000, `redis on ${REDIS_PORT} (is redis-server installed, and the port free?)`);

    const shared = {}; // group -> { child, port }: suites in one group share a backend
    for (const s of SUITES.filter((x) => wanted(x.name))) {
      let child, p;
      if (s.group) {
        if (!shared[s.group]) {
          p = port++;
          await flushDb(s.db);
          const c = startBackend(p, s.db, s.env);
          shared[s.group] = { child: c, port: p };
          try { await waitFor(httpUp(p), 20000, "backend"); } catch (e) { results.push({ name: s.name, error: `${e.message}\n${c.getErr().slice(-400)}` }); continue; }
        }
        ({ child, port: p } = shared[s.group]);
      } else {
        p = port++;
        await flushDb(s.db);
        child = startBackend(p, s.db, s.env);
        try { await waitFor(httpUp(p), 20000, "backend"); } catch (e) { results.push({ name: s.name, error: `${e.message}\n${child.getErr().slice(-400)}` }); await stop(child); continue; }
      }
      const target = s.arg === "url" ? `http://localhost:${p}` : String(p);
      const t0 = Date.now();
      process.stdout.write(`running ${s.name.padEnd(28)} `);
      const r = await runNode(s.name, target, s.timeoutMs);
      const sum = summarize(r.out);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const ok = r.code === 0 && (!sum || sum.fail === 0);
      console.log(`${ok ? "PASS" : "FAIL"}  ${sum ? `${sum.pass} passed, ${sum.fail} failed` : `exit ${r.code}`}  (${secs}s)`);
      results.push({ name: s.name, ok, sum, code: r.code, out: r.out });
      if (!s.group) await stop(child);
    }
    for (const g of Object.values(shared)) await stop(g.child);

    if (wanted("eunit")) {
      process.stdout.write(`running ${"erlang unit tests (eunit)".padEnd(28)} `);
      // rebar3 on PATH if there is one, else the copy in tools/ run through escript
      let r = spawnSync("rebar3", ["eunit"], { cwd: backend, encoding: "utf8", timeout: 240000, env: { ...process.env, NO_COLOR: "1" } });
      if (r.error) r = spawnSync("escript", [path.join(backend, "tools", "rebar3"), "eunit"], { cwd: backend, encoding: "utf8", timeout: 240000, env: { ...process.env, NO_COLOR: "1" } });
      const out = ((r.stdout || "") + (r.stderr || "")).replace(/\u001b\[[0-9;]*m/g, "");
      const m = out.match(/(\d+) tests?, (\d+) failures?/) || out.match(/All (\d+) tests passed/);
      const ok = r.status === 0;
      const sum = m ? (m[2] !== undefined ? { pass: +m[1] - +m[2], fail: +m[2] } : { pass: +m[1], fail: 0 }) : null;
      console.log(`${ok ? "PASS" : "FAIL"}  ${sum ? `${sum.pass} passed, ${sum.fail} failed` : `exit ${r.status}`}`);
      results.push({ name: "eunit", ok, sum, code: r.status, out });
    }
  } finally {
    redis.kill("SIGTERM");
  }

  const failed = results.filter((r) => r.error || r.ok === false);
  console.log("\n================ SUMMARY ================");
  let tp = 0, tf = 0;
  for (const r of results) {
    if (r.error) { console.log(`ERROR ${r.name}: ${r.error}`); continue; }
    tp += r.sum?.pass || 0; tf += r.sum?.fail || 0;
    console.log(`${r.ok ? "PASS " : "FAIL "} ${r.name.padEnd(28)} ${r.sum ? `${r.sum.pass} passed, ${r.sum.fail} failed` : `exit ${r.code}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} suites passed; ${tp} checks passed, ${tf} failed`);
  for (const r of failed) {
    if (r.error) continue;
    console.log(`\n----- ${r.name}: failing lines -----`);
    const lines = r.out.split("\n").filter((l) => /FAIL|ERROR|Error:|✗|not ok|TIMED OUT/i.test(l));
    console.log((lines.length ? lines : r.out.split("\n").slice(-12)).slice(0, 25).join("\n"));
  }
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("run_all crashed:", e); process.exit(2); });
