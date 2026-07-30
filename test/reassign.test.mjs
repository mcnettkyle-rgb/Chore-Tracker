// Moving a chore from one child to the other.
//
// generate_week() used to sweep instances only when their assignment had been
// switched off. Reassigning a chore leaves the assignment perfectly active
// while every instance it already produced points at the wrong child — so the
// chore appeared on BOTH kids' lists, and the schedule showed only one owner.
//
// Also covers the profile picker's count, which counted expired chores the kid
// screen had already filed under "Missed": one tile read "29 to do today" over
// a list of six.

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
const CHORE = 'Load the dishwasher';

/** Names of the chores on a given kid's actionable lists. */
async function choresFor(name) {
  await page.click('.profile:has-text("' + name + '")');
  await page.waitForSelector('.summary');
  const names = await page.locator('.section:not(.fold) .chore .chore__name').allTextContents();
  const tally = await page.locator('.topbar__sub').textContent();
  const dueToday = await page.locator('.section:has(.section__title:text-is("Due today")) .chore').count();
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { names: names.map((n) => n.trim()), tally: (tally ?? '').trim(), dueToday };
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// The seed gives "Load the dishwasher" to the first child only.
const first = (await page.locator('.profile__name').allTextContents())[0].trim();
const second = (await page.locator('.profile__name').allTextContents())[1].trim();

const beforeFirst = await choresFor(first);
const beforeSecond = await choresFor(second);
check(beforeFirst.names.includes(CHORE), `${first} starts with "${CHORE}"`);
check(!beforeSecond.names.includes(CHORE), `${second} does not`);

// ---- the picker tile must agree with the kid's own header ----
const tileText = await page.locator(`.profile:has-text("${first}") .profile__meta`).textContent();
const tileCount = Number((tileText.match(/\d+/) ?? [0])[0]);
check(tileCount === beforeFirst.dueToday,
  `picker tile matches the kid's "Due today" list (tile ${tileCount}, list ${beforeFirst.dueToday})`);
check(beforeFirst.tally.startsWith(String(tileCount)) || beforeFirst.tally.includes('done'),
  `the kid's header agrees too ("${beforeFirst.tally}")`);

// ---- reassign it to the other child ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click(`.row:has-text("${CHORE}")`);
await page.waitForSelector('dialog:has-text("Edit chore")');
await page.selectOption('dialog select >> nth=0', { label: second });
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(1000);

const summary = await page.locator(`.row:has-text("${CHORE}") .row__meta`).textContent();
check(summary.includes(second) && !summary.includes(first),
  `the schedule now reads "${summary.trim()}"`);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

// ---- the chore must have MOVED, not been duplicated ----
const afterFirst = await choresFor(first);
const afterSecond = await choresFor(second);

check(!afterFirst.names.includes(CHORE), `"${CHORE}" is gone from ${first}`);
check(afterSecond.names.includes(CHORE), `"${CHORE}" now appears for ${second}`);

// ---- and it must not come back on reload ----
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.picker');
const reloadFirst = await choresFor(first);
check(!reloadFirst.names.includes(CHORE),
  'still gone after a reload, so generate_week swept it rather than recreating it');

// ---- tiles still agree after the change ----
for (const name of [first, second]) {
  const info = await choresFor(name);
  const tile = await page.locator(`.profile:has-text("${name}") .profile__meta`).textContent();
  const n = Number((tile.match(/\d+/) ?? [0])[0]);
  check(n === info.dueToday, `${name}: tile (${n}) matches "Due today" (${info.dueToday})`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL REASSIGN TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
