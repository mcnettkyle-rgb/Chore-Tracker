// The parent's week navigation must not follow you onto a kid's screen.
//
// state.weekStart is one global, shared by the parent's Schedule tab (which can
// page back and forth through weeks) and by every screen that asks "what does
// this kid have on?". Nothing reset it on the way out, so:
//
//   parent → Schedule → "›" → Lock → tap a kid
//
// left the kid looking at NEXT week. Next week has not been generated yet, so
// the list came back empty and both the picker tile and the kid's own header
// announced "All done 🎉" over a full day of unfinished chores. The ledger's
// "earned this week" and the queue's "Approved this week" read from the same
// snapshot and drifted with it.
//
// A kid's screen is always about today. This pins that down.

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

/** What a kid's own screen says, then back to the picker. */
async function kidView(name) {
  await page.click(`.profile:has-text("${name}")`);
  await page.waitForSelector('.summary');
  const chores = await page.locator('.section:not(.fold) .chore .chore__name').allTextContents();
  const header = ((await page.locator('.topbar__sub').textContent()) ?? '').trim();
  const today = await page.locator('.stat:has(.stat__label:text-is("Today")) .stat__value').textContent();
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { chores: chores.map((c) => c.trim()), header, today: (today ?? '').trim() };
}

const tile = async (name) =>
  ((await page.locator(`.profile:has-text("${name}") .profile__meta`).textContent()) ?? '').trim();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

const kid = (await page.locator('.profile__name').allTextContents())[0].trim();

// ---- baseline: this kid genuinely has work to do ----
const before = await kidView(kid);
const tileBefore = await tile(kid);
check(before.chores.length > 0, `${kid} starts with ${before.chores.length} chores listed`);
check(before.today !== '', `the Today counter reads "${before.today}"`);

// ---- parent pages forward a week, then locks ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.week-nav .btn[aria-label="Next week"]');
await page.waitForTimeout(400);
check(await page.locator('.banner:has-text("Viewing another week")').count() > 0,
  'the parent is now looking at another week');

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

// ---- the kid must be unaffected ----
const tileAfter = await tile(kid);
check(tileAfter === tileBefore,
  `picker tile is unchanged ("${tileAfter}" vs "${tileBefore}")`);
check(!/all done/i.test(tileAfter) || before.chores.length === 0,
  `tile does not claim "all done" while ${before.chores.length} chores are outstanding ("${tileAfter}")`);

const after = await kidView(kid);
check(after.chores.length === before.chores.length,
  `${kid} still sees ${before.chores.length} chores (got ${after.chores.length})`);
check(after.today === before.today,
  `the Today counter still reads "${before.today}" (got "${after.today}")`);
check(after.header === before.header,
  `the kid's header still reads "${before.header}" (got "${after.header}")`);

// ---- and the parent's own week-scoped figures are back on this week ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin(PIN); await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
check(await page.locator('.banner:has-text("Viewing another week")').count() === 0,
  're-entering the parent screen starts on this week, not wherever you left off');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL WEEK-LEAK TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
