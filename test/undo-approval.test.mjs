// Undoing an approval.
//
// Approving was a one-way door. Worse for auto-approve chores, which pay the
// instant a kid taps them — a mis-tap was permanent, with the chore sitting in
// "Finished this week" and nowhere in the parent UI able to reach it.

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
const money = (label) => page.locator(`.stat:has(.stat__label:text-is("${label}")) .stat__value`).textContent();
const APPROVED = 'details.fold:has(.section__title:text-is("Approved this week"))';

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// ---- a kid taps an auto-approve chore: paid instantly, no review ----
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');
const target = page.locator('.section:not(.fold) .chore:has-text("Read for 20 minutes")').first();
const choreName = (await target.locator('.chore__name').textContent()).trim();
await target.click();
await page.waitForTimeout(700);

const earned = (await money('Earned this week')).trim();
const balance = (await money('Your money')).trim();
check(earned !== '$0.00', `auto-approve chore paid immediately (${earned})`);
check(balance === earned, `it landed in the balance (${balance})`);
check((await page.textContent('body')).includes('Finished this week'),
  'and it sits in "Finished this week" with no way for the kid to undo it');

// ---- the parent can undo it ----
await page.click('.topbar .btn:text-is("Switch")');
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

check(await page.locator(APPROVED).count() === 1, 'the queue offers an "Approved this week" section');
check(await page.locator(`${APPROVED}[open]`).count() === 0, 'it starts folded, out of the way');

await page.click(`${APPROVED} summary`);
await page.waitForTimeout(300);
check((await page.locator(`${APPROVED} .row:has-text("${choreName}")`).count()) === 1,
  `the auto-approved chore is listed (${choreName})`);

await page.click(`${APPROVED} .row:has-text("${choreName}") .btn:text-is("Undo")`);
await page.waitForSelector('dialog:has-text("Undo this?")');
check((await page.textContent('dialog')).includes('comes off their balance'),
  'the confirmation says the money is taken back');
await page.click('dialog .btn--primary');
await page.waitForTimeout(900);

// ---- the chore is back on the kid's list, money gone ----
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
await page.click('.profile >> nth=0');
await page.waitForSelector('.summary');

check((await money('Earned this week')).trim() === '$0.00', 'earnings are back to zero');
check((await money('Your money')).trim() === '$0.00', 'the balance is back to zero');

const body = await page.textContent('body');
check(!body.includes('Finished this week'), 'it left "Finished this week"');
check(!body.includes('Needs another look'),
  'the kid sees no "needs redo" note — an undo is not a rejection');

const backOnList = await page.locator(`.section:not(.fold) .chore:has-text("${choreName}")`).count();
check(backOnList >= 1, 'the chore is back on the to-do list as not done');

// ---- and it can be done again normally ----
await page.locator(`.section:not(.fold) .chore:has-text("${choreName}")`).first().click();
await page.waitForTimeout(700);
check((await money('Earned this week')).trim() !== '$0.00', 'it can be completed again afterwards');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL UNDO-APPROVAL TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
