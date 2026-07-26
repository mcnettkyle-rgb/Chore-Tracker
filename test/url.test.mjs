// The Supabase dashboard shows several URLs and it is genuinely easy to copy
// the wrong one. Pasting the REST endpoint produces requests to
// /rest/v1/rest/v1/... and the error "Invalid path specified in request URL",
// which tells you nothing about the actual cause.
//
// Run: node test/url.test.mjs

import { normalizeSupabaseUrl } from '../js/supabase-adapter.js';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const EXPECTED = 'https://abc.supabase.co';

const trimmed = [
  ['https://abc.supabase.co',              'already correct, left alone'],
  ['https://abc.supabase.co/',             'trailing slash'],
  ['https://abc.supabase.co///',           'several trailing slashes'],
  ['  https://abc.supabase.co  ',          'surrounding whitespace'],
  ['https://abc.supabase.co/rest/v1',      'REST endpoint'],
  ['https://abc.supabase.co/rest/v1/',     'REST endpoint with slash'],
  ['https://abc.supabase.co/auth/v1/',     'auth endpoint'],
  ['https://abc.supabase.co/storage/v1',   'storage endpoint'],
  ['https://abc.supabase.co/graphql/v1',   'graphql endpoint'],
  ['https://abc.supabase.co/realtime/v1',  'realtime endpoint'],
  ['https://abc.supabase.co/functions/v1', 'functions endpoint'],
  ['https://abc.supabase.co/REST/V1/',     'endpoint in capitals'],
];

for (const [input, label] of trimmed) {
  const { url } = normalizeSupabaseUrl(input);
  check(url === EXPECTED, `${label}: ${JSON.stringify(input)} -> ${JSON.stringify(url)}`);
}

// It must report when it changed something, so init() can warn.
check(normalizeSupabaseUrl('https://abc.supabase.co').changed === false, 'clean URL reports changed=false');
check(normalizeSupabaseUrl('https://abc.supabase.co/rest/v1/').changed === true, 'trimmed URL reports changed=true');

// Anything that isn't scheme://host must fail the adapter's validation rather
// than being quietly accepted.
const looksValid = (u) => /^https?:\/\/[^/]+$/.test(normalizeSupabaseUrl(u).url);
for (const bad of ['', '   ', 'abc.supabase.co', 'https://abc.supabase.co/some/other/path', 'not a url', null, undefined]) {
  check(!looksValid(bad), `rejects ${JSON.stringify(bad)}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL URL TESTS PASSED');
process.exit(failures ? 1 : 0);
