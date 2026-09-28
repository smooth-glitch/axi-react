#!/usr/bin/env node
// `npm run dev` (repo root): starts the app.
//   1. installs dependencies in web/ if node_modules is missing
//   2. starts the web app (web/, :8081)
// There is no backend to start: structs, records, options and files are stored in the browser (IndexedDB).
// Anything already running on the port is reused. Ctrl+C stops what this script started.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const WEB_PORT = 8081; // fixed in web/vite.config.js (the e2e suite relies on it)

const tag = (t) => `\x1b[35m[${t}]\x1b[0m`;
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

function killTree(child) {
  if (!child.pid) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log('dev', 'stopping...');
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

(async () => {
  if (!fs.existsSync(path.join(root, 'web', 'node_modules'))) {
    log('setup', 'web/node_modules is missing - running npm install (first run only)...');
    const r = spawnSync('npm', ['install'], { cwd: path.join(root, 'web'), stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      log('setup', 'npm install failed in web');
      process.exit(1);
    }
  }
  if (await portOpen(WEB_PORT)) log('web', `Web app already running on :${WEB_PORT} - reusing it`);
  else {
    const child = spawn('npm', ['run', 'dev'], { cwd: path.join(root, 'web'), shell: true, env: process.env, windowsHide: true });
    children.push(child);
    pipe('web', child.stdout);
    pipe('web', child.stderr);
    child.on('exit', (code) => {
      if (!stopping) {
        log('web', `exited (code ${code}).`);
        shutdown(code || 1);
      }
    });
    if (!(await waitForPort(WEB_PORT, 30000))) {
      log('web', `Web app did not open :${WEB_PORT} within 30s.`);
      shutdown(1);
      return;
    }
  }
  log('dev', `\x1b[1mReady ->  http://localhost:${WEB_PORT}\x1b[0m   (data is stored in this browser; no server needed)   Ctrl+C to stop`);
})();
