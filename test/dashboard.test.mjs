// The parent Progress tab, driven in a real browser.
//
// The arithmetic itself is covered by test/stats.test.mjs; this checks the
// wiring — that the tab renders, timeframes actually change what's shown, and
// approving a chore moves the figures rather than serving a stale cache.

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
page.on('console', (m) => { if (m.type() === 'error') { console.log('CONSOLE', m.text()); failures++; } });

const typePin = async (pin) => { for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`); };
const TIMEFRAMES = '.tabs >> nth=1';
const stat = (label) => `.stat:has(.stat__label:text-is("${label}")) .stat__value`;

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// ---- a kid does some chores ----
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');
for (let i = 0; i < 3; i++) {
  await page.locator('.section:not(.fold) .chore:not([disabled])').first().click();
  await page.waitForTimeout(300);
}

// ---- into the parent screen ----
await page.click('.topbar .btn:text-is("Switch")');
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Progress")');
await page.waitForSelector('.ring', { timeout: 10000 });
check(true, 'Progress tab renders');

// ---- timeframe picker ----
const labels = await page.locator(`${TIMEFRAMES} >> .tab`).allTextContents();
check(labels.length === 5, `five timeframes (${labels.join(', ')})`);
check(labels[0] === 'This week' && labels[4] === 'All time', 'this week first, all time last');

// ---- the ring must actually be driven by the rate ----
const ring = await page.locator('.ring').first().evaluate((n) => ({
  pct: getComputedStyle(n).getPropertyValue('--ring-pct').trim(),
  label: n.textContent.trim(),
}));
check(ring.label.endsWith('%'), `ring shows a percentage (${ring.label})`);
check(ring.pct === ring.label.replace('%', ''),
  `ring fill matches the label (--ring-pct=${ring.pct}, label=${ring.label})`);

// ---- per-child cards ----
const cards = await page.locator('.balance').count();
check(cards === 2, `one card per child (${cards})`);
for (const f of ['Earned', 'Missed', 'To check', 'Still to come']) {
  check(await page.locator(`.figure__label:text-is("${f}")`).count() >= 1, `card shows "${f}"`);
}
check(await page.locator('.lifetime').count() === 2, 'each card carries lifetime totals');
check((await page.locator('.lifetime').first().textContent()).includes('earned'),
  'lifetime line names earned / paid / owed');

// ---- switching timeframe changes what is shown ----
const thisWeekEarned = await page.locator(stat('Earned in this period')).textContent();
await page.click(`${TIMEFRAMES} >> .tab:text-is("Last week")`);
await page.waitForTimeout(800);
const lastWeekEarned = await page.locator(stat('Earned in this period')).textContent();
check(lastWeekEarned.trim() === '$0.00', `last week has no earnings yet (${lastWeekEarned.trim()})`);
check(await page.locator(stat('Completion')).textContent() === '—',
  'completion is "—" when nothing was scheduled, not 0%');

await page.click(`${TIMEFRAMES} >> .tab:text-is("All time")`);
await page.waitForTimeout(800);
check((await page.textContent('body')).includes('Every chore ever scheduled'),
  'all time drops the date range caption');
const allTimeEarned = await page.locator(stat('Earned in this period')).textContent();
check(allTimeEarned === thisWeekEarned,
  `all time matches this week while that is all the data there is (${allTimeEarned})`);

// ---- approving must move the figures, not serve a stale cache ----
await page.click(`${TIMEFRAMES} >> .tab:text-is("This week")`);
await page.waitForTimeout(700);
const before = await page.locator(stat('Earned in this period')).textContent();

await page.click('.tab:text-is("To check")');
await page.waitForSelector('.review');
await page.click('.review .btn--good');
await page.waitForTimeout(800);

await page.click('.tab:text-is("Progress")');
await page.waitForSelector('.ring');
await page.waitForTimeout(800);
const after = await page.locator(stat('Earned in this period')).textContent();
check(before !== after, `approving updates the dashboard (${before} → ${after})`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL DASHBOARD TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
