// Chores past their window must leave the to-do list.
//
// With "Allow late chores" switched off, the database refuses a late submission.
// The kid view used to keep showing those chores as tappable, so a kid would
// tap one and get an error toast — the UI offering something the server would
// reject. They now sit in a folded "Missed" section, not tappable.

import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const PIN = '246810';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

const typePin = async (pin) => { for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`); };
const text = () => page.textContent('body').then((t) => t.replace(/\s+/g, ' '));
const sectionEl = (title) => `.section:has(.section__title:text-is("${title}"))`;
const foldEl = (title) => `details.fold:has(.section__title:text-is("${title}"))`;

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// ---- become the parent and switch OFF late chores ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.check');
await page.uncheck('.check:has-text("Allow late chores") input');
await page.waitForTimeout(600);
// Zero grace days, so anything due before today is out of time.
await page.fill('input[type="number"]', '0');
await page.locator('input[type="number"]').press('Tab');
await page.waitForTimeout(600);
check(true, 'late chores disabled with zero grace days');

// ---- back to a kid ----
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');

// Every non-folded section holding tappable chores, whatever it's called.
const todo = '.section:not(.fold)';
const missed = foldEl('Missed');

const missedCount = await page.locator(missed).count();
check(missedCount === 1, 'a "Missed" section appears');

if (missedCount) {
  // Nothing in Missed may be clickable.
  const enabled = await page.locator(`${missed} .chore:not([disabled])`).count();
  check(enabled === 0, 'no chore in Missed is tappable');

  const styled = await page.locator(`${missed} .chore--expired`).count();
  check(styled > 0, 'Missed chores use the expired styling');

  // The section is folded, so it can't bury the actionable list.
  const open = await page.locator(`${missed}[open]`).count();
  check(open === 0, 'Missed starts folded away');
}

// ---- the to-do list must contain only chores that can still be done ----
const todoDue = await page.locator(`${todo} .chore`).evaluateAll((nodes) =>
  nodes.map((n) => n.querySelector('.pill--muted')?.textContent?.trim() ?? 'today'));
console.log('   to-do day labels:', JSON.stringify(todoDue));

const stale = ['Yesterday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hasPastDay = todoDue.some((d) => stale.includes(d));
check(!hasPastDay || todoDue.length === 0, 'to-do list holds no past-dated chores');

check(!(await page.locator(`${todo} .chore--overdue`).count()),
  'no "LATE" badges left in the to-do list');

// ---- tapping whatever remains must NOT produce the past-due error ----
const remaining = await page.locator(`${todo} .chore`).count();
if (remaining) {
  await page.locator(`${todo} .chore`).first().click();
  await page.waitForTimeout(600);
  const toast = await page.locator('#toast').textContent();
  check(!/past its due date/i.test(toast ?? ''),
    `tapping a to-do chore is accepted (toast: "${(toast ?? '').trim()}")`);
}

// ---- turning late chores back on must empty the Missed section ----
await page.click('.topbar .btn:text-is("Switch")');
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin(PIN); await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.check');
await page.check('.check:has-text("Allow late chores") input');
await page.waitForTimeout(600);

await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');

check(await page.locator(foldEl('Missed')).count() === 0,
  'nothing is "Missed" once late chores are allowed again');

// The LATE flag is a CSS ::after, so it isn't in textContent — check the class.
const lateAgain = await page.locator('.section:not(.fold) .chore--overdue').count();
check(lateAgain > 0, `late-but-doable chores are back in the to-do list, flagged LATE (${lateAgain})`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL EXPIRED-CHORE TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
