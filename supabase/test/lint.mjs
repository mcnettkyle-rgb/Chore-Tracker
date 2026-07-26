// Static checks on the SQL that a running Postgres won't necessarily catch.
//
// Run: node supabase/test/lint.mjs
//
// The big one is UPDATE/DELETE without a WHERE clause. Supabase can enable the
// `safeupdate` extension, which rejects those outright — so a statement that
// works on a stock Postgres fails on a real project. Worse, it fails at the
// moment it matters: writing the parent PIN silently did nothing, leaving the
// approvals screen unlocked while the app reported success.
//
// `where singleton` is the idiom for the single-row household table.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['schema.sql', 'notifications.sql', 'seed.sql', 'reset.sql']
  .map((f) => path.join(HERE, '..', f));

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

/** Collect statements starting with the given keywords, with their line numbers. */
function statements(src, startRe) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('--')) continue;
    if (!startRe.test(trimmed.toLowerCase())) continue;

    const buf = [];
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      buf.push(lines[j].replace(/--.*$/, ''));   // strip trailing comments
      if (lines[j].includes(';')) break;
    }
    out.push({ line: i + 1, first: trimmed, text: buf.join(' ').toLowerCase() });
  }
  return out;
}

for (const file of FILES) {
  const name = path.basename(file);
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    continue;   // optional files
  }

  // ---- UPDATE / DELETE must be bounded ----
  const writes = statements(src, /^(update|delete\s+from)\s/);
  const unbounded = writes.filter((s) => !/\swhere\s/.test(s.text));
  check(
    unbounded.length === 0,
    `${name}: every UPDATE/DELETE has a WHERE clause` +
      (unbounded.length ? `\n         ${unbounded.map((u) => `line ${u.line}: ${u.first}`).join('\n         ')}` : ''),
  );

  // ---- SECURITY DEFINER functions must pin a search_path ----
  // Without one they resolve names against the caller's path, which is both a
  // privilege-escalation risk and how pgcrypto went missing on Supabase.
  const defs = [...src.matchAll(/security definer([\s\S]{0,200}?)\bas\s*\$\$/gi)];
  const missingPath = defs.filter((m) => !/set\s+search_path\s*=/i.test(m[1]));
  check(missingPath.length === 0,
    `${name}: every SECURITY DEFINER function pins search_path (${defs.length} checked)`);

  // ---- and that search_path must include the extensions schema ----
  const paths = [...src.matchAll(/set\s+search_path\s*=\s*([^\n]+)/gi)].map((m) => m[1].trim());
  const publicOnly = paths.filter((p) => !/extensions/.test(p));
  check(publicOnly.length === 0,
    `${name}: search_path includes "extensions" so pgcrypto resolves on Supabase (${paths.length} checked)`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SQL LINT CHECKS PASSED');
process.exit(failures ? 1 : 0);
