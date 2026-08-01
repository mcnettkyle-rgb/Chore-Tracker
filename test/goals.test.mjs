// Savings goals on the kid's own screen.
//
// "You have $14.25" is abstract at 8 and 10. "You're most of the way to the
// roller skates" is not. The bar is the point, so this checks it appears for a
// child with a goal, stays absent for one without, and — the part that is easy
// to get wrong — can actually be cleared again once set.

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

/** The goal bar on a kid's screen, if there is one. */
async function goalFor(name) {
  await page.click(`.profile:has-text("${name}")`);
  await page.waitForSelector('.summary');
  await page.waitForTimeout(300);
  const present = await page.locator('.goal').count();
  const label = present ? ((await page.locator('.goal__label').textContent()) ?? '').trim() : null;
  const figures = present ? ((await page.locator('.goal__figures').textContent()) ?? '').trim() : null;
  const note = present ? ((await page.locator('.goal__note').textContent()) ?? '').trim() : null;
  const width = present
    ? await page.locator('.goal__fill').evaluate((n) => n.style.width)
    : null;
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { present, label, figures, note, width };
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

const names = (await page.locator('.profile__name').allTextContents()).map((n) => n.trim());
const [withGoal, without] = names;

// ---- the seed ships one of each ----
const a = await goalFor(withGoal);
check(a.present === 1, `${withGoal} has a goal bar`);
check(/Roller skates/.test(a.label ?? ''), `it names what they're saving for ("${a.label}")`);
check(/\$0\.00 of \$25\.00/.test(a.figures ?? ''), `and shows progress ("${a.figures}")`);
check(/to go/.test(a.note ?? ''), `with how much is left ("${a.note}")`);
check(a.width === '0%', `the bar starts empty at a zero balance (got "${a.width}")`);

const b = await goalFor(without);
check(b.present === 0, `${without} has no goal bar, because no goal is set`);

// ---- first-run setup ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

// ---- give the other child a goal ----
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.section:has-text("Children")');
await page.click(`.row:has-text("${without}")`);
await page.waitForSelector(`dialog:has-text("Edit ${without}")`);
await page.fill('dialog input[placeholder="e.g. Roller skates"]', 'A new bike');
await page.fill('dialog input[placeholder="25.00"]', '60');
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(800);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

const c = await goalFor(without);
check(c.present === 1, `${without} now has a goal bar`);
check(/A new bike/.test(c.label ?? ''), `named correctly ("${c.label}")`);
check(/of \$60\.00/.test(c.figures ?? ''), `at the right amount ("${c.figures}")`);

// ---- and it can be taken away again ----
// Clearing is the case a coalesce()-style update silently drops: the empty
// value reads as "not supplied" and the old goal survives forever.
await enterParent();
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.section:has-text("Children")');
await page.click(`.row:has-text("${without}")`);
await page.waitForSelector(`dialog:has-text("Edit ${without}")`);
await page.fill('dialog input[placeholder="25.00"]', '');
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(800);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

const d = await goalFor(without);
check(d.present === 0, `clearing the amount removes the goal again (bar count ${d.present})`);

// ---- reaching the goal reads as a win, not an overflow ----
await enterParent();
await page.click('.tab:text-is("Money")');
await page.waitForSelector('.balance');
await page.click(`.balance:has-text("${withGoal}") .btn:text-is("Adjust")`);
await page.waitForSelector('dialog:has-text("Adjust")');
await page.fill('dialog input[placeholder="1.00"]', '40');
await page.fill('dialog input[placeholder*="birthday"]', 'test top-up');
await page.click('dialog .btn--primary');
await page.waitForTimeout(800);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');

const e = await goalFor(withGoal);
check(e.width === '100%', `an over-target balance caps the bar at 100% (got "${e.width}")`);
check(/of \$25\.00/.test(e.figures ?? '') && !/\$40/.test(e.figures ?? ''),
  `the figures cap at the goal rather than overflowing ("${e.figures}")`);
check(/saved enough/.test(e.note ?? ''), `and it reads as reached ("${e.note}")`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL GOAL TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
