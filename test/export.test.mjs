// Downloading a backup.
//
// Years of chore history live in exactly one Supabase project with no backup
// on the free tier. This is the insurance, so the file has to be genuinely
// complete and genuinely readable without this app.
//
// The check that matters most is the negative one: the parent PIN hash must
// never be in it. A backup lands in a Downloads folder, gets emailed to
// yourself, ends up in cloud sync — none of which should carry the credential
// that guards the approvals screen.

import { readFileSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const PIN = '246810';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1400 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

const typePin = async (pin) => { for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`); };

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

// Put something in the ledger so the export has money history to carry.
await page.click('.tab:text-is("Money")');
await page.waitForSelector('.balance');
await page.click('.balance >> nth=0 >> .btn:text-is("Adjust")');
await page.waitForSelector('dialog:has-text("Adjust")');
await page.fill('dialog input[placeholder="1.00"]', '5');
await page.fill('dialog input[placeholder*="birthday"]', 'export fixture');
await page.click('dialog .btn--primary');
await page.waitForTimeout(600);

// ---- download it ----
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.section:has-text("Backup")');

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.btn:has-text("Download everything")'),
]);

const name = download.suggestedFilename();
check(/^chore-tracker-\d{4}-\d{2}-\d{2}\.json$/.test(name),
  `the file is named by date ("${name}")`);

const path = await download.path();
const raw = readFileSync(path, 'utf8');

let data;
try {
  data = JSON.parse(raw);
  check(true, 'it parses as JSON');
} catch (err) {
  check(false, `it parses as JSON — ${err.message}`);
  console.log(failures ? `\n${failures} FAILURE(S)` : '');
  await browser.close();
  process.exit(1);
}

// ---- everything worth keeping is in there ----
for (const key of ['household', 'children', 'chores', 'rotation_groups',
                   'assignments', 'chore_instances', 'ledger_entries']) {
  check(data[key] !== undefined, `it contains "${key}"`);
}

check(Array.isArray(data.children) && data.children.length >= 2,
  `both children are in it (${data.children?.length})`);
check(Array.isArray(data.chore_instances) && data.chore_instances.length > 0,
  `the chore history is in it (${data.chore_instances?.length} rows)`);
check(data.ledger_entries.some((l) => l.note === 'export fixture'),
  'the money entry made above is in it');
check(typeof data.schema_version === 'number',
  `it records the schema version it came from (${data.schema_version})`);
check(typeof data.exported_at === 'string' && !Number.isNaN(Date.parse(data.exported_at)),
  'and when it was taken');

// Savings goals are part of a child's record, so they must survive a backup.
check(data.children.some((c) => c.goal_cents),
  'a savings goal is preserved');

// ---- and the PIN is NOT ----
check(!/parent_pin_hash/.test(raw), 'the file never mentions parent_pin_hash');
check(!/pin_attempts/.test(raw), 'nor the PIN attempt log');
check(!/parent_sessions/.test(raw), 'nor any session token');
check(data.household && data.household.parent_pin_hash === undefined,
  'the household record carries no PIN hash');

// A backup that quietly dropped everything would still pass the checks above
// if they were sloppy, so assert the thing has real size to it.
check(raw.length > 2000, `the file has substance (${raw.length} bytes)`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL EXPORT TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
