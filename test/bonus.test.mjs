// Bonus chores: harder jobs worth extra that cost nothing to skip.
//
// The promise is an asymmetry — doing one pays, skipping one is free — so the
// assertions that matter are almost all about what a bonus job must NOT do.
// A hard optional job that quietly dents a completion rate or breaks a streak
// is not a bonus, it's just another chore with a nicer label, and kids work
// that out within a week.

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
const num = (s) => Number((String(s ?? '').match(/-?\d+/) ?? [0])[0]);

async function kidView(name) {
  await page.click(`.profile:has-text("${name}")`);
  await page.waitForSelector('.summary');
  await page.waitForTimeout(400);
  const bonusSection = await page.locator('.section:has-text("Bonus jobs")').count();
  const bonusCards = await page.locator('.section:has-text("Bonus jobs") .chore').count();
  const header = ((await page.locator('.topbar__sub').textContent()) ?? '').trim();
  const todayRing = ((await page.locator('.stat:has(.stat__label:text-is("Today")) .stat__value').textContent()) ?? '').trim();
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { bonusSection, bonusCards, header, todayRing };
}

const tile = async (name) =>
  ((await page.locator(`.profile:has-text("${name}") .profile__meta`).textContent()) ?? '').trim();

async function dashboard() {
  await page.click('.tab:text-is("Progress")');
  await page.waitForSelector('.summary');
  await page.waitForTimeout(700);
  const val = async (label) =>
    ((await page.locator(`.stat:has(.stat__label:text-is("${label}")) .stat__value`).textContent()) ?? '').trim();
  return { missed: await val('Missed'), completion: await val('Completion'), earned: await val('Earned in this period') };
}

const enterParent = async () => {
  await page.click('.profile--parent');
  await page.waitForSelector('dialog .pin-key');
  await typePin(PIN);
  await page.click('dialog .btn--primary');
  await page.waitForSelector('.tabs');
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

const kid = (await page.locator('.profile__name').allTextContents())[0].trim();

// ---- the seed ships one bonus job ----
const seeded = await kidView(kid);
check(seeded.bonusSection === 1, `${kid} has a "Bonus jobs" section from the seed`);
check(seeded.bonusCards > 0, `with ${seeded.bonusCards} job(s) in it`);

const tileBefore = await tile(kid);
const ringBefore = seeded.todayRing;

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

const dashBefore = await dashboard();

// ---- add a bonus chore due every day ----
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.btn--primary:text-is("+ Add a chore")');
await page.waitForSelector('dialog:has-text("New chore")');
await page.fill('dialog input[placeholder="e.g. Load the dishwasher"]', 'Scrub the bins');
await page.fill('dialog input[placeholder="0.50"]', '5.00');
await page.selectOption('dialog select >> nth=0', { index: 0 });
// The bonus toggle is the second checkbox in the dialog (after "pay without checking").
await page.check('dialog .check:has-text("Bonus job") input[type="checkbox"]');
// Turn on every day, so one is definitely due today.
const dayButtons = page.locator('dialog .day-toggle');
for (let i = 0; i < await dayButtons.count(); i++) {
  const btn = dayButtons.nth(i);
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
}
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(1200);

check(await page.locator('.row:has-text("Scrub the bins") .pill--bonus').count() > 0,
  'the schedule marks it as a bonus chore');

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

// ---- it must not read as work the child owes ----
const tileAfter = await tile(kid);
check(tileAfter === tileBefore,
  `the picker tile is unchanged by an unclaimed bonus job ("${tileBefore}" → "${tileAfter}")`);

const withBonus = await kidView(kid);
check(withBonus.bonusCards > seeded.bonusCards,
  `the new job joins the Bonus section (${seeded.bonusCards} → ${withBonus.bonusCards})`);
check(withBonus.todayRing === ringBefore,
  `today's ring is unchanged ("${ringBefore}" → "${withBonus.todayRing}")`);
check(withBonus.header === seeded.header,
  `and the header still says "${seeded.header}"`);

// It should not have leaked into the ordinary to-do sections.
await page.click(`.profile:has-text("${kid}")`);
await page.waitForSelector('.summary');
const inDueToday = await page.locator('.section:has(.section__title:text-is("Due today")) .chore:has-text("Scrub the bins")').count();
check(inDueToday === 0, 'it does not appear under "Due today"');
// Scheduled every day, so it is one claimable card per day — each a separate
// chance at the money, distinguished by the day label on the card.
const bonusCopies = await page.locator('.section:has-text("Bonus jobs") .chore:has-text("Scrub the bins")').count();
check(bonusCopies >= 1, `it appears under "Bonus jobs" instead (${bonusCopies} day(s))`);
check(await page.locator('.section:has-text("Bonus jobs") .chore:has-text("Scrub the bins") .pill--bonus').count() === bonusCopies,
  'every one is badged as a bonus');
check(await page.locator('.section:has-text("Bonus jobs") .chore--overdue').count() === 0,
  'and none of them is flagged LATE — a bonus job is never owed');
await page.click('.topbar .btn:text-is("Switch")');
await page.waitForSelector('.picker');

// ---- leaving it undone must cost nothing ----
await enterParent();
const dashUnclaimed = await dashboard();
check(dashUnclaimed.missed === dashBefore.missed,
  `an unclaimed bonus job adds nothing to Missed ("${dashBefore.missed}" → "${dashUnclaimed.missed}")`);
check(dashUnclaimed.completion === dashBefore.completion,
  `and does not move Completion ("${dashBefore.completion}" → "${dashUnclaimed.completion}")`);
check(await page.locator('.figure:has(.figure__label:text-is("Bonus"))').count() > 0,
  'the dashboard reports bonus jobs separately');

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

// ---- doing one pays, but must not inflate the rate ----
await page.click(`.profile:has-text("${kid}")`);
await page.waitForSelector('.summary');
await page.click('.section:has-text("Bonus jobs") .chore:has-text("Scrub the bins")');
await page.waitForTimeout(700);
check(await page.locator('.section:has-text("Waiting to be checked") .chore:has-text("Scrub the bins")').count() === 1,
  'a bonus job can be marked done like any other chore');
await page.click('.topbar .btn:text-is("Switch")');
await page.waitForSelector('.picker');

await enterParent();
await page.waitForSelector('.review');
await page.click('.review:has-text("Scrub the bins") .btn--good');
await page.waitForTimeout(900);

const dashDone = await dashboard();
check(num(dashDone.earned) > num(dashBefore.earned),
  `finishing it pays real money ("${dashBefore.earned}" → "${dashDone.earned}")`);
check(dashDone.completion === dashBefore.completion,
  `but the completion rate is untouched ("${dashBefore.completion}" → "${dashDone.completion}")`);
check(dashDone.missed === dashBefore.missed,
  'and Missed is still unchanged');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL BONUS TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
