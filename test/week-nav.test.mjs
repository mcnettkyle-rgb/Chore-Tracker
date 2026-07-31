// Paging forward through the schedule has to actually show next week's plan.
//
// generate_week() only ever ran for the CURRENT week — on boot, and after an
// edit. The Schedule tab's "›" button changed which week the snapshot fetched
// but never asked for that week to be generated, so a week nobody had lived
// through yet had no chore_instances at all and the "Planned" grid came back
// as a full set of em dashes. The one screen built for answering "what does
// next week look like?" answered "nothing".
//
// Paging BACKWARD must not generate anything. Materialising a past week would
// invent chores nobody was ever asked to do, and every one of them scores as a
// miss the moment it lands — a parent browsing back through history would
// quietly wreck their own completion rate.

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

/** How many real chores the "Planned" grid is showing. */
const planned = () => page.locator('.grid-table .mini').count();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

/** This week's "Missed" figure on the Progress tab. */
async function missedCount() {
  await page.click('.tab:text-is("Progress")');
  await page.waitForSelector('.summary');
  await page.waitForTimeout(600);
  const text = await page.locator('.stat:has(.stat__label:text-is("Missed")) .stat__value').textContent();
  return (text ?? '').trim();
}

// The seed backfills the whole current week, so days already past are legitimately
// missed. What matters is that browsing weeks doesn't ADD to this.
const missedBefore = await missedCount();

await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');

const thisWeek = await planned();
check(thisWeek > 0, `this week's grid shows ${thisWeek} planned chores`);

// ---- forward: next week must be populated ----
await page.click('.week-nav .btn[aria-label="Next week"]');
await page.waitForTimeout(800);
const nextWeek = await planned();
check(nextWeek > 0, `next week's grid is populated too (${nextWeek} chores), not a wall of dashes`);

// Two weeks out should work the same way.
await page.click('.week-nav .btn[aria-label="Next week"]');
await page.waitForTimeout(800);
const twoOut = await planned();
check(twoOut > 0, `two weeks out is populated as well (${twoOut} chores)`);

// ---- backward: a past week must be left alone ----
await page.click('.week-nav .btn:text-is("‹")');
await page.waitForTimeout(400);
await page.click('.week-nav .btn:text-is("‹")');
await page.waitForTimeout(400);
await page.click('.week-nav .btn:text-is("‹")');
await page.waitForTimeout(800);
check(await page.locator('.banner:has-text("Viewing another week")').count() > 0,
  'now viewing a week before this one');
const lastWeek = await planned();
check(lastWeek === 0,
  `a past week stays empty (${lastWeek}) rather than inventing chores that score as missed`);

// ---- and the completion rate is untouched by the browsing ----
const missedAfter = await missedCount();
check(missedAfter === missedBefore,
  `this week's Missed count is unchanged by browsing weeks ("${missedBefore}" → "${missedAfter}")`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL WEEK-NAV TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
