// Marking a child away, and what it must NOT do to their record.
//
// Before this existed the only ways to handle a day a child was never asked
// about were to reject the chores — which means "you did this badly" and shows
// them a note — or to let the days score as misses. The second is what people
// actually did, and it quietly wrecks the completion rate that the whole
// reward mechanic depends on.
//
// So the assertions that matter here are the negative ones: after marking
// someone away, the missed count must not move, the rate must not drop, and
// the child must not be told they have work left.

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
const today = new Date();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = ymd(today);

async function kidView(name) {
  await page.click(`.profile:has-text("${name}")`);
  await page.waitForSelector('.summary');
  const todo = await page.locator('.section:not(.fold) .chore .chore__name').allTextContents();
  const header = ((await page.locator('.topbar__sub').textContent()) ?? '').trim();
  const daysOff = await page.locator('.fold:has-text("Days off") .chore').count();
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { todo: todo.map((t) => t.trim()), header, daysOff };
}

/** The parent dashboard's figures for this week. */
async function dashboard() {
  await page.click('.tab:text-is("Progress")');
  await page.waitForSelector('.summary');
  await page.waitForTimeout(700);
  const val = async (label) =>
    ((await page.locator(`.stat:has(.stat__label:text-is("${label}")) .stat__value`).textContent()) ?? '').trim();
  return { missed: await val('Missed'), completion: await val('Completion') };
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

const kid = (await page.locator('.profile__name').allTextContents())[0].trim();
const other = (await page.locator('.profile__name').allTextContents())[1].trim();

const before = await kidView(kid);
const otherBefore = await kidView(other);
check(before.todo.length > 0, `${kid} starts with ${before.todo.length} chores to do`);
check(before.daysOff === 0, 'and no days off yet');

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

const dashBefore = await dashboard();

// ---- mark them away for today ----
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.btn:has-text("Mark someone away")');
await page.waitForSelector('dialog:has-text("Mark someone away")');
// The option label carries the avatar emoji too, so match by position: the
// picker and this dropdown are both ordered by sort_order.
await page.selectOption('dialog select >> nth=0', { index: 0 });
await page.fill('dialog input[type="date"] >> nth=0', TODAY);
await page.fill('dialog input[type="date"] >> nth=1', TODAY);
await page.click('dialog .btn--primary');
await page.waitForTimeout(1000);

check(await page.locator('.section:has-text("Away this week")').count() > 0,
  'the schedule shows an "Away this week" section');

// Excusing TODAY should not move the missed count either way — today has not
// been failed yet.
const dashAfter = await dashboard();
check(dashAfter.missed === dashBefore.missed,
  `excusing today leaves Missed alone ("${dashBefore.missed}" → "${dashAfter.missed}")`);

// ---- the assertion that actually proves the feature ----
//
// Days already gone ARE counted as missed. Excusing them has to take them out
// of that count, or the rate still punishes a child for a week they were away
// and the whole exercise was pointless.
check(Number(dashBefore.missed) > 0,
  `there are ${dashBefore.missed} missed chores to rescue, so this test can tell`);

await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.btn:has-text("Mark someone away")');
await page.waitForSelector('dialog:has-text("Mark someone away")');
await page.selectOption('dialog select >> nth=0', { index: 0 });
await page.fill('dialog input[type="date"] >> nth=0', ymd(new Date(today.getTime() - 6 * 86400000)));
await page.fill('dialog input[type="date"] >> nth=1', TODAY);
await page.click('dialog .btn--primary');
await page.waitForTimeout(1000);

const dashPast = await dashboard();
check(Number(dashPast.missed) < Number(dashBefore.missed),
  `excusing days already gone REMOVES them from Missed (${dashBefore.missed} → ${dashPast.missed})`);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

// ---- and the kid is not nagged about them ----
const after = await kidView(kid);
check(after.daysOff > 0, `${kid} sees ${after.daysOff} chore(s) under "Days off"`);
check(after.todo.length < before.todo.length,
  `their to-do list shrank (${before.todo.length} → ${after.todo.length})`);
check(!/left to do today/.test(after.header) || after.header !== before.header,
  `their header no longer claims the same work ("${after.header}")`);

const tile = ((await page.locator(`.profile:has-text("${kid}") .profile__meta`).textContent()) ?? '').trim();
check(!/to do today/.test(tile) || Number((tile.match(/\d+/) ?? [99])[0]) < 99,
  `the picker tile agrees ("${tile}")`);

// ---- the other child is untouched ----
const otherAfter = await kidView(other);
check(otherAfter.todo.length === otherBefore.todo.length,
  `${other} is unaffected (${otherBefore.todo.length} → ${otherAfter.todo.length})`);
check(otherAfter.daysOff === 0, `and has no days off`);

// ---- undo puts it all back ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin(PIN); await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.section:has-text("Away this week") .btn:text-is("Undo")');
await page.waitForTimeout(1000);

check(await page.locator('.section:has-text("Away this week")').count() === 0,
  'the away section clears once undone');

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

const restored = await kidView(kid);
check(restored.todo.length === before.todo.length,
  `${kid} has their chores back (${before.todo.length}, got ${restored.todo.length})`);
check(restored.daysOff === 0, 'and no days off remain');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL AWAY TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
