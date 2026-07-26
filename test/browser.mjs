// Finds Playwright and a browser binary, wherever they happen to live.
//
// NODE_PATH doesn't apply to ESM imports, so a globally-installed Playwright
// isn't importable by name. Try the plain import first (local node_modules),
// then fall back to well-known global locations.

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch { /* not in local node_modules — keep looking */ }

  const roots = [];
  if (process.env.PLAYWRIGHT_PATH) roots.push(process.env.PLAYWRIGHT_PATH);
  try {
    roots.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch { /* npm not available */ }
  roots.push('/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright');

  for (const root of roots) {
    for (const entry of [root, path.join(root, 'index.mjs'), path.join(root, 'index.js')]) {
      if (existsSync(entry)) {
        try {
          return await import(pathToFileURL(entry).href);
        } catch { /* try the next candidate */ }
      }
    }
  }

  throw new Error(
    'Could not find Playwright. Install it with `npm i -D playwright`, ' +
    'or point PLAYWRIGHT_PATH at a global install.',
  );
}

/** Chromium ships in a few places depending on how it was installed. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    const candidates = [
      path.join(base, 'chromium', 'chrome-linux', 'chrome'),
      path.join(base, 'chromium'),
    ];
    for (const c of candidates) if (existsSync(c)) return c;

    // Versioned directories, e.g. chromium-1194/
    try {
      const dirs = execSync(`ls -d ${base}/chromium-* 2>/dev/null || true`, { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
      for (const dir of dirs) {
        const bin = path.join(dir, 'chrome-linux', 'chrome');
        if (existsSync(bin)) return bin;
      }
    } catch { /* fall through to Playwright's own lookup */ }
  }
  return null;
}

export async function launchBrowser() {
  const { chromium } = await loadPlaywright();
  const executablePath = findChrome();
  return chromium.launch(executablePath ? { executablePath } : {});
}
