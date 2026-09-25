#!/usr/bin/env node
// `npm run dev` (repo root): starts everything needed to use the app.
//   1. installs dependencies in server/ and web/ if node_modules is missing
//   2. makes sure Redis is reachable: a local Redis is started with `redis-server` if nothing listens on the port;
//      a remote one (REDIS_HOST=other-machine) is only checked, never started
//   3. starts the API (server/, :4000) and the web app (web/, :8081)
// Anything already running on those ports is reused. Ctrl+C stops what this script started.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const API_PORT = Number(process.env.PORT) || 4000;
const WEB_PORT = 8081; // fixed in web/vite.config.js (the e2e suite relies on it)

const COLORS = { setup: '\x1b[32m', redis: '\x1b[33m', api: '\x1b[36m', web: '\x1b[35m', dev: '\x1b[1m' };
const RESET = '\x1b[0m';
const tag = (t) => `${COLORS[t] || ''}[${t}]${RESET}`;
const log = (t, msg) => console.log(`${tag(t)} ${msg}`);

const children = [];
let stopping = false;

const portOpen = (port, host = 'localhost', timeout = 600) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });

const waitForPort = async (port, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

function pipe(t, stream) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const l of lines) if (l.trim()) console.log(`${tag(t)} ${l}`);
  });
}

function start(t, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, shell: true, env: process.env, windowsHide: true });
  children.push({ t, child });
  pipe(t, child.stdout);
  pipe(t, child.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      log(t, `exited (code ${code}). Stopping everything.`);
      shutdown(code || 1);
    }
  });
  return child;
}

function killTree(child) {
  if (!child.pid) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log('dev', 'stopping...');
  for (const { child } of children) killTree(child);
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function ensureDeps(dir) {
  if (fs.existsSync(path.join(root, dir, 'node_modules'))) return;
  log('setup', `${dir}/node_modules is missing - running npm install (first run only)...`);
  const r = spawnSync('npm', ['install'], { cwd: path.join(root, dir), stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    log('setup', `npm install failed in ${dir}`);
    process.exit(1);
  }
}

async function ensureRedis() {
  // A remote Redis (REDIS_HOST set to something other than this machine) is never started here - only checked.
  const host = process.env.REDIS_HOST || 'localhost';
  const remote = !['localhost', '127.0.0.1', '::1'].includes(host);
  if (remote) {
    if (await portOpen(REDIS_PORT, host, 2000)) return log('redis', `using remote Redis at ${host}:${REDIS_PORT}`);
    log('redis', `cannot reach Redis at ${host}:${REDIS_PORT} (REDIS_HOST / REDIS_PORT). Check the address and your network.`);
    process.exit(1);
  }
  if (await portOpen(REDIS_PORT)) return log('redis', `already running on :${REDIS_PORT}`);
  log('redis', `nothing on :${REDIS_PORT} - starting redis-server...`);
  const probe = spawnSync(isWin ? 'where' : 'which', ['redis-server'], { shell: true, stdio: 'ignore' });
  if (probe.status !== 0) {
    log('redis', 'redis-server was not found on your PATH. Install Redis (https://redis.io/docs/getting-started/) or start it yourself, then run `npm run dev` again.');
    process.exit(1);
  }
  start('redis', 'redis-server', ['--port', String(REDIS_PORT)], root);
  if (!(await waitForPort(REDIS_PORT, 10000))) {
    log('redis', 'Redis did not start within 10s.');
    shutdown(1);
    return new Promise(() => {});
  }
  log('redis', `started on :${REDIS_PORT}`);
}

async function ensureService(t, port, cmd, args, cwd, label) {
  if (await portOpen(port)) return log(t, `${label} already running on :${port} - reusing it`);
  start(t, cmd, args, cwd);
  if (!(await waitForPort(port, 30000))) {
    log(t, `${label} did not open :${port} within 30s.`);
    shutdown(1);
    return new Promise(() => {});
  }
  log(t, `${label} is up on :${port}`);
}

(async () => {
  ensureDeps('server');
  ensureDeps('web');
  await ensureRedis();
  await ensureService('api', API_PORT, 'npm', ['start'], path.join(root, 'server'), 'API');
  await ensureService('web', WEB_PORT, 'npm', ['run', 'dev'], path.join(root, 'web'), 'Web app');
  log('dev', `\x1b[1mReady ->  http://localhost:${WEB_PORT}\x1b[0m   (API http://localhost:${API_PORT}/health)   Ctrl+C to stop`);
})();
