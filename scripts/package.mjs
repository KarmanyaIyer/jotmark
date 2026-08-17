// Builds the zip that gets uploaded to the Chrome Web Store.
// Usage: node scripts/package.mjs   ->  dist/jotmark-<version>.zip
// The archive contains the contents of extension/ with manifest.json at its root.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { EXTENSION_DIR, ROOT } from './lib/browser.mjs';

const manifest = JSON.parse(readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
const distDir = path.join(ROOT, 'dist');
const out = path.join(distDir, `jotmark-${manifest.version}.zip`);

mkdirSync(distDir, { recursive: true });
if (existsSync(out)) rmSync(out);

// -X drops macOS resource forks, -x skips files that should never ship.
execFileSync('zip', ['-r', '-X', out, '.', '-x', '.DS_Store', '*/.DS_Store', '*.map'], { cwd: EXTENSION_DIR, stdio: 'inherit' });

const listing = execFileSync('unzip', ['-l', out], { encoding: 'utf8' });
if (!/\bmanifest\.json\b/.test(listing)) {
  throw new Error('manifest.json is missing from the archive');
}
console.log(`\nwrote ${path.relative(ROOT, out)}`);
