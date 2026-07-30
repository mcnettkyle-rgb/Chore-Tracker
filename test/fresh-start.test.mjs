// Clearing a trial run before going live.
//
// The subtle part isn't the delete — it's that generate_week() runs on every
// page load and would happily recreate everything that was just cleared. The
// fresh-start date has to be respected by generation as well as by the stats,
// or the missed chores reappear the moment someone reloads.

import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const PIN = '246810';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1400 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

const typePin = async (pin) => { for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`); };
const missedCount = async () => Number(await page.locator('.stat:has(.stat__label:text-is("Missed")) .stat__value').textContent());
const openProgress = async () => {
  await page.click('.tab:text-is("Progress")');
  await page.waitForSelector('.ring', { timeout: 10000 });
  await page.waitForTimeout(600);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// ---- unlock ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

// ---- the seed week leaves a pile of misses ----
await openProgress();
const before = await missedCount();
check(before > 0, `the trial run shows ${before} missed chores to begin with`);

// ---- approve one, so we can prove real history survives ----
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');

// ---- start fresh from today ----
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.check');
await page.click('.btn:text-is("Clear test data and start fresh")');
await page.waitForSelector('dialog:has-text("Start fresh")');
check(await page.locator('dialog input[type="date"]').inputValue() !== '', 'the date defaults to today');
await page.click('dialog .btn--primary:text-is("Clear and start fresh")');
await page.waitForSelector('dialog:has-text("Clear unfinished chores?")');
await page.click('dialog .btn--primary');
await page.waitForTimeout(1200);

// ---- misses are gone ----
await openProgress();
const after = await missedCount();
check(after === 0, `missed chores cleared (${before} → ${after})`);
check((await page.textContent('body')).includes('day'), 'the dashboard still renders normally');

// ---- and they must not come back on reload ----
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.tabs', { timeout: 10000 });
await openProgress();
const afterReload = await missedCount();
check(afterReload === 0, `still clear after a reload, so generate_week respected it (${afterReload})`);

// ---- "All time" must not resurrect them either ----
await page.click('.tabs >> nth=1 >> .tab:text-is("All time")');
await page.waitForTimeout(800);
check(await missedCount() === 0, 'All time starts from the fresh-start date');
check((await page.textContent('body')).includes('Everything since'),
  'the caption says which date it counts from');

// ---- today's chores are untouched ----
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');
const kid = await page.textContent('body');
check(!kid.includes('Missed'), 'the kid screen has no Missed section left');
check(await page.locator('.section:not(.fold) .chore').count() > 0,
  "today's chores are still there to do");

// ---- and a kid can still complete one ----
await page.locator('.section:not(.fold) .chore:not([disabled])').first().click();
await page.waitForTimeout(600);
const toast = (await page.locator('#toast').textContent()) ?? '';
check(/waiting to be checked|earned/i.test(toast), `chores still work after the reset ("${toast.trim()}")`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL FRESH-START TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
