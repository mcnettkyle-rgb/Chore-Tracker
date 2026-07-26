import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const SHOT = process.env.SHOT_DIR ?? '/tmp/chore-tracker-shots';
const PIN = '246810';

import { mkdirSync } from 'node:fs';
mkdirSync(SHOT, { recursive: true });

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));

const text = () => page.textContent('body').then((t) => t.replace(/\s+/g, ' '));
const typePin = async (pin) => {
  for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// ---------------------------------------------------------------- picker
check((await text()).includes('Ava'), 'picker shows Ava');
check((await text()).includes('Parent'), 'picker shows Parent tile');
await page.screenshot({ path: `${SHOT}/01-picker.png`, fullPage: true });

// ---------------------------------------------------------------- kid view
await page.click('.profile:has-text("Ava")');
await page.waitForSelector('.summary');
check((await text()).includes('Hi Ava'), 'kid view greets Ava');
await page.screenshot({ path: `${SHOT}/02-kid.png`, fullPage: true });

// Grab the first non-auto-approve chore in the "To do" list.
const firstChore = page.locator('.section:has(.section__title:text-is("To do")) .chore').first();
const choreName = (await firstChore.locator('.chore__name').textContent()).trim();
const choreValue = (await firstChore.locator('.chore__value').textContent()).trim();
console.log(`   (marking "${choreName}" worth ${choreValue})`);

const earnedBefore = await page.locator('.stat--earned .stat__value').textContent();
await firstChore.click();
await page.waitForTimeout(400);

const afterSubmit = await text();
check(afterSubmit.includes('Waiting to be checked'), 'chore moved to "Waiting to be checked"');
const earnedAfterSubmit = await page.locator('.stat--earned .stat__value').textContent();
check(earnedBefore === earnedAfterSubmit, 'marking done did NOT change earned total');
await page.screenshot({ path: `${SHOT}/03-kid-waiting.png`, fullPage: true });

// ---------------------------------------------------------------- undo
const waitingSection = '.section:has(.section__title:text-is("Waiting to be checked"))';
check(await page.locator(waitingSection).count() === 1, 'waiting section exists before undo');
await page.click(`${waitingSection} .chore:has-text("${choreName}")`);
await page.waitForTimeout(400);
check(await page.locator(waitingSection).count() === 0, 'undo returned the chore to the to-do list');

// re-submit for the approval flow
await page.locator('.section:has(.section__title:text-is("To do")) .chore').first().click();
await page.waitForTimeout(400);

// ---------------------------------------------------------------- parent
await page.click('.topbar .btn:text-is("Switch")');
await page.waitForSelector('.picker');
check((await text()).includes('1 to check'), 'parent tile shows 1 waiting');

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await page.screenshot({ path: `${SHOT}/04-pinpad.png` });
await typePin('1111');
await page.click('dialog .btn--primary');
await page.waitForTimeout(600);

// First run has no PIN, so any code gets in and we're asked to set one.
const setPinVisible = await page.locator('dialog:has-text("Choose a parent PIN")').count();
check(setPinVisible === 1, 'first unlock prompts to choose a PIN');
await typePin(PIN);
await page.click('dialog .btn--primary');       // Next
await page.waitForTimeout(200);
await typePin(PIN);
await page.click('dialog .btn--primary');       // Set PIN
await page.waitForTimeout(600);

await page.waitForSelector('.tabs');
check((await text()).includes('To check'), 'parent tabs rendered');
check(!(await text()).includes('No PIN set'), 'no-PIN warning is gone after setting one');
await page.screenshot({ path: `${SHOT}/05-queue.png`, fullPage: true });

// ---------------------------------------------------------------- reject
check((await text()).includes(choreName), 'submitted chore is in the queue');
await page.click('.review .btn--danger');
await page.waitForSelector('dialog:has-text("Send it back")');
await page.fill('dialog textarea', 'There are still socks on the floor');
await page.click('dialog .btn--primary');
await page.waitForTimeout(600);
check((await text()).includes('Nothing to check'), 'queue empties after sending it back');

// kid sees the note
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
await page.click('.profile:has-text("Ava")');
await page.waitForTimeout(400);
const kidAfterReject = await text();
check(kidAfterReject.includes('Needs another look'), 'kid sees "Needs another look"');
check(kidAfterReject.includes('still socks on the floor'), "kid sees the parent's note");
await page.screenshot({ path: `${SHOT}/06-kid-redo.png`, fullPage: true });

// ---------------------------------------------------------------- redo + approve
await page.click('.section:has(.section__title:text-is("Needs another look")) .chore');
await page.waitForTimeout(400);
check((await text()).includes('Waiting to be checked'), 'kid can resubmit after a redo');

await page.click('.topbar .btn:text-is("Switch")');
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin(PIN);
await page.click('dialog .btn--primary');
await page.waitForTimeout(600);
check((await page.locator('.tabs').count()) === 1, 'real PIN unlocks the parent screen');

await page.click('.review .btn--good');
await page.waitForTimeout(600);
check((await text()).includes('Nothing to check'), 'queue empties after approving');

// ---------------------------------------------------------------- money
await page.click('.tab:text-is("Money")');
await page.waitForSelector('.balance');
const ledgerText = await text();
check(ledgerText.includes(choreName), 'approved chore appears in the ledger history');
const avaBalance = await page.locator('.balance:has-text("Ava") .balance__amount').textContent();
check(avaBalance.trim() === choreValue, `Ava's balance equals the chore value (${avaBalance.trim()} vs ${choreValue})`);
await page.screenshot({ path: `${SHOT}/07-money.png`, fullPage: true });

// ---------------------------------------------------------------- payout
await page.click('.balance:has-text("Ava") .btn--primary');
await page.waitForSelector('dialog:has-text("Pay Ava")');
await page.click('dialog .btn--primary');
await page.waitForTimeout(600);
const afterPayout = await page.locator('.balance:has-text("Ava") .balance__amount').textContent();
check(afterPayout.trim().replace(/[^0-9]/g, '') === '000', `payout zeroed the balance (${afterPayout.trim()})`);
check((await text()).includes('Paid out'), 'payout shows in history');

// ---------------------------------------------------------------- schedule
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
const sched = await text();
check(sched.includes('Take out the trash'), 'schedule lists chores');
check(sched.includes('Rotations'), 'rotations section present');
await page.screenshot({ path: `${SHOT}/08-schedule.png`, fullPage: true });

// ---------------------------------------------------------------- settings
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.check');
check((await text()).includes('Week starts on'), 'settings shows rules');
await page.screenshot({ path: `${SHOT}/09-settings.png`, fullPage: true });

console.log('\n--- console errors ---');
console.log(errors.length ? errors.join('\n') : 'none');
if (errors.length) failures++;

console.log(`\n${failures === 0 ? 'ALL BROWSER TESTS PASSED' : `${failures} FAILURE(S)`}`);
await browser.close();
process.exit(failures ? 1 : 0);
