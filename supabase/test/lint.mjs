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

  // ---- enum values added by an upgrade may only be used from plpgsql ----
  //
  // The Supabase SQL editor runs this file as one transaction, and Postgres
  // refuses to use an enum value in the same transaction that added it. A
  // `language sql` body is parsed at CREATE time and trips that immediately;
  // a `language plpgsql` body is not parsed until it runs, long after commit.
  //
  // The trap is that this only fails on an UPGRADE — a fresh install has the
  // value in the original CREATE TYPE and sails through — so it would sail
  // past every test here and land on a live database only.
  const added = [...src.matchAll(/alter\s+type\s+\w+\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi)]
    .map((m) => m[1]);

  for (const value of added) {
    // Split into function definitions and check the language of any that
    // mention the newly-added value.
    const bodies = [...src.matchAll(/create\s+or\s+replace\s+function\s+(\w+)([\s\S]*?)\$\$([\s\S]*?)\$\$/gi)];
    const offenders = bodies
      .filter((m) => new RegExp(`'${value}'`).test(m[3]))
      .filter((m) => !/language\s+plpgsql/i.test(m[2]))
      .map((m) => m[1]);

    check(offenders.length === 0,
      `${name}: functions using the added enum value '${value}' are plpgsql, not sql` +
        (offenders.length ? `\n         ${offenders.join(', ')} — would fail on an UPGRADE only` : ''));
  }
}

// ---- schema.sql and the app must agree on the version number ----
//
// The app compares schema_version() against EXPECTED_SCHEMA_VERSION to decide
// whether to tell the parent their database is behind. Bump one and forget the
// other and that banner either cries wolf on a perfectly current database, or
// stays silent on a genuinely stale one — and the second is how a missing
// function reaches a live project as a raw PostgREST error.
{
  const schema = readFileSync(path.join(HERE, '..', 'schema.sql'), 'utf8');
  const app = readFileSync(path.join(HERE, '..', '..', 'js', 'version.js'), 'utf8');

  const inSql = schema.match(/create or replace function schema_version\(\)[\s\S]*?select\s+(\d+)\s*;/i)?.[1];
  const inApp = app.match(/EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1];

  check(inSql !== undefined, 'schema.sql declares a schema_version()');
  check(inApp !== undefined, 'js/version.js declares EXPECTED_SCHEMA_VERSION');
  check(inSql === inApp,
    `schema.sql (${inSql}) and js/version.js (${inApp}) agree on the schema version`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SQL LINT CHECKS PASSED');
process.exit(failures ? 1 : 0);
