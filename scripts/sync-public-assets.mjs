// Copies (not symlinks) the shared ARM-API-integrated service files +
// styles.css from shared/ into public/, so `npm run dev` / `npm run build`
// work identically on every OS. Symlinks (an earlier approach) are recorded
// in git as a special mode and require the checkout tool to understand
// them — git on Windows checks them out as plain text files containing the
// literal target path unless core.symlinks is explicitly enabled, and a
// GitHub "Download ZIP" doesn't reliably preserve them either. A real copy
// has no such dependency. Run automatically before `dev`/`build` (see
// package.json's pre* scripts) so it's always fresh.
//
// shared/ (not a sibling repo) is the source of truth for these files in
// THIS repo. They originated in smooth-glitch/axibot (the previous home of
// this app, before axi-react and axibot were split back into separate
// repos) and are genuinely real ARM-API-integrated code, not the old
// vanilla-hybrid app — deliberately not rewritten, see each file's own
// header comment for why. If axibot's copies ever get a fix, port it here
// too — there is currently no automated sync between the two repos.
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', 'shared');
const publicDir = join(__dirname, '..', 'public');

const FILES = [
  'axi-standalone-bridge.js',
  'axi-standalone-bridge.jsx',
  'sandesh-standalone-bridge.jsx',
  'axi-foundation.js',
  'axi-foundation.jsx',
  'sandesh-foundation.jsx',
  'axi-databin-services.js',
  'axi-databin-services.jsx',
  'sandesh-databin-services.jsx',
  'axi-admin-services.js',
  'axi-admin-services.jsx',
  'sandesh-admin-services.jsx',
  'axi-databin-core.js',
  'axi-databin-core.jsx',
  'sandesh-databin-core.jsx',
  'axi-databin-extras.js',
  'axi-databin-extras.jsx',
  'sandesh-databin-extras.jsx',
  'axi-ui-polish.js',
  'axi-ui-polish.jsx',
  'sandesh-ui-polish.jsx',
  'axi-push-to-tstruct.js',
  'axi-push-to-tstruct.jsx',
  'sandesh-push-to-tstruct.jsx',
  'styles.css',
];

let copied = 0;
for (const name of FILES) {
  const src = join(repoRoot, name);
  const dest = join(publicDir, name);
  if (!existsSync(src)) {
    console.error(`[sync-public-assets] Missing source file: ${src}`);
    process.exitCode = 1;
    continue;
  }
  // Skip the copy if dest already matches src (same size + mtime >=) to
  // avoid needless disk churn on every dev-server restart.
  if (existsSync(dest)) {
    const s = statSync(src);
    const d = statSync(dest);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
  }
  copyFileSync(src, dest);
  copied += 1;
}

if (copied > 0) {
  console.log(`[sync-public-assets] Synced ${copied} file(s) from shared/ into public/.`);
}
