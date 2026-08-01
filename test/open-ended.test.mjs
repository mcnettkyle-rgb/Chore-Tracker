// A bonus job with no deadline, driven through the real UI.
//
// The database side is covered in supabase/test/open.test.sql. What this adds
// is the thing a kid would actually notice: everything in this app fetches one
// week at a time, so an open job created in one week could easily be invisible
// in every other. A chore with no deadline that you can only see for seven
// days is worse than not having the feature.

import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const PIN = '246810';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1600 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

const typePin = async (pin) => { for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`); };
const JOB = 'Sort the loft';

const enterParent = async () => {
  await page.click('.profile--parent');
  await page.waitForSelector('dialog .pin-key');
  await typePin(PIN);
  await page.click('dialog .btn--primary');
  await page.waitForSelector('.tabs');
};

/** How many copies of the job the kid can see, and whether it's badged. */
async function kidSees() {
  await page.click('.profile >> nth=0');
  await page.waitForSelector('.summary');
  await page.waitForTimeout(400);
  const cards = await page.locator(`.section:has-text("Bonus jobs") .chore:has-text("${JOB}")`).count();
  const noDeadline = await page.locator(`.chore:has-text("${JOB}") .pill:has-text("No deadline")`).count();
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { cards, noDeadline };
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.btn--primary:text-is("+ Add a chore")');
await page.waitForSelector('dialog:has-text("New chore")');

// ---- the option is bonus-only ----
const whenOptions = async () =>
  (await page.locator('dialog select >> nth=1').locator('option').allTextContents()).map((t) => t.trim());

check(!(await whenOptions()).some((o) => /no deadline/i.test(o)),
  'an ordinary chore is not offered "no deadline"');

await page.check('dialog .check:has-text("Bonus job") input[type="checkbox"]');
await page.waitForTimeout(200);
check((await whenOptions()).some((o) => /no deadline/i.test(o)),
  'ticking "Bonus job" offers it');

// Unticking must withdraw it again, and not leave the select blank.
await page.uncheck('dialog .check:has-text("Bonus job") input[type="checkbox"]');
await page.waitForTimeout(200);
check(!(await whenOptions()).some((o) => /no deadline/i.test(o)), 'unticking withdraws it');

await page.check('dialog .check:has-text("Bonus job") input[type="checkbox"]');
await page.waitForTimeout(200);
await page.selectOption('dialog select >> nth=1', 'open');
await page.uncheck('dialog .check:has-text("Bonus job") input[type="checkbox"]');
await page.waitForTimeout(200);
const fallback = await page.locator('dialog select >> nth=1').inputValue();
check(fallback === 'anytime',
  `unticking while "no deadline" is chosen falls back to a real schedule (got "${fallback}")`);

// ---- create it for real ----
await page.check('dialog .check:has-text("Bonus job") input[type="checkbox"]');
await page.waitForTimeout(200);
await page.fill('dialog input[placeholder="e.g. Load the dishwasher"]', JOB);
await page.fill('dialog input[placeholder="0.50"]', '10.00');
await page.selectOption('dialog select >> nth=0', { index: 0 });
await page.selectOption('dialog select >> nth=1', 'open');
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(1200);

const meta = ((await page.locator(`.row:has-text("${JOB}") .row__meta`).textContent()) ?? '').trim();
check(/no deadline/i.test(meta), `the schedule describes it as open-ended ("${meta}")`);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

const first = await kidSees();
check(first.cards === 1, `the kid sees exactly one copy (${first.cards})`);
check(first.noDeadline === 1, 'badged "No deadline" so it reads differently from "anytime this week"');

// ---- the part that matters: it must survive the week moving ----
await enterParent();
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.week-nav .btn[aria-label="Next week"]');
await page.waitForTimeout(900);
check(await page.locator(`.grid-table .mini:has-text("${JOB}")`).count() > 0,
  'it still shows on next week\'s grid — an open job belongs to no week');

await page.click('.week-nav .btn[aria-label="Next week"]');
await page.waitForTimeout(900);
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

const afterWeeks = await kidSees();
check(afterWeeks.cards === 1,
  `still exactly one copy after generating two more weeks (${afterWeeks.cards})`);

// A reload re-runs generate_week from scratch, which is where a duplicate
// would show up if the "create once" check were wrong.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.picker');
const afterReload = await kidSees();
check(afterReload.cards === 1, `and still one after a reload (${afterReload.cards})`);

// ---- doing it pays, and it does not come back ----
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');
await page.click(`.section:has-text("Bonus jobs") .chore:has-text("${JOB}")`);
await page.waitForTimeout(700);
await page.click('.topbar .btn:text-is("Switch")');
await page.waitForSelector('.picker');

await enterParent();
await page.waitForSelector('.review');
await page.click(`.review:has-text("${JOB}") .btn--good`);
await page.waitForTimeout(900);
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.picker');
const afterDone = await kidSees();
check(afterDone.cards === 0,
  `once finished it leaves the bonus list rather than being reissued (${afterDone.cards})`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OPEN-ENDED TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
