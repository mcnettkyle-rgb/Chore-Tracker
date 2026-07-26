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
const typePin = async (pin) => { for (const d of pin) await page.click(`dialog .pin-key:text-is("${d}")`); };

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

// ---- get into the parent screen and set a PIN ----
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111');
await page.click('dialog .btn--primary');
await page.waitForTimeout(500);
await typePin(PIN);
await page.click('dialog .btn--primary');
await page.waitForTimeout(200);
await typePin(PIN);
await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

// =====================================================================
// Add a brand new chore, assigned to Mia on Sundays
// =====================================================================
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
await page.click('.btn:text-is("+ Add a chore")');
await page.waitForSelector('dialog:has-text("New chore")');
await page.screenshot({ path: `${SHOT}/10-chore-editor.png` });

await page.fill('dialog input[placeholder="e.g. Load the dishwasher"]', 'Water the plants');
await page.fill('dialog input[inputmode="decimal"]', '1.25');
await page.selectOption('dialog select >> nth=0', { label: 'Mia' });

// Clear the default Mon–Fri, then pick Sunday only.
for (const initial of ['M', 'T', 'W', 'T', 'F']) {
  const btn = page.locator('dialog .day-toggle[aria-pressed="true"]').first();
  if (await btn.count()) await btn.click();
}
check(await page.locator('dialog .day-toggle[aria-pressed="true"]').count() === 0, 'cleared the default days');
await page.click('dialog .day-toggle >> nth=0');   // first column = week start = Sunday
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(800);

const sched = await text();
check(sched.includes('Water the plants'), 'new chore appears in the chore list');
check(sched.includes('Mia · Sun'), 'new chore shows "Mia · Sun"');
check(sched.includes('$1.25'), 'new chore shows its value');

// =====================================================================
// Validation: a chore with no days should be refused
// =====================================================================
await page.click('.row:has-text("Water the plants")');
await page.waitForSelector('dialog:has-text("Edit chore")');
await page.click('dialog .day-toggle[aria-pressed="true"]');   // unset the only day
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(300);
check(await page.locator('dialog').count() === 1, 'dialog stays open when no day is picked');
check((await page.textContent('dialog .pin-error')).includes('at least one day'), 'shows a validation message');

// =====================================================================
// Re-price: unstarted chores update, the schedule reflects it
// =====================================================================
await page.click('dialog .day-toggle >> nth=0');   // put Sunday back
await page.fill('dialog input[inputmode="decimal"]', '2.00');
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(800);
check((await text()).includes('$2.00'), 're-pricing a chore updates the list');

// =====================================================================
// The kid sees it
// =====================================================================
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
await page.click('.profile:has-text("Mia")');
await page.waitForSelector('.summary');
const kidText = await text();
check(kidText.includes('Water the plants'), "new chore shows up on Mia's list");
check(kidText.includes('$2.00'), 'kid sees the new price');
await page.screenshot({ path: `${SHOT}/11-kid-mia.png`, fullPage: true });

// =====================================================================
// Add a child, change the currency
// =====================================================================
await page.click('.topbar .btn:text-is("Switch")');
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin(PIN);
await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.check');
await page.click('.btn:text-is("+ Add a child")');
await page.waitForSelector('dialog:has-text("Add a child")');
await page.fill('dialog input[placeholder="Name"]', 'Sam');
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(700);
check((await text()).includes('Sam'), 'added a third child');
await page.screenshot({ path: `${SHOT}/12-settings.png`, fullPage: true });

// currency
await page.fill('input[maxlength="3"]', '£');
await page.locator('input[maxlength="3"]').press('Tab');
await page.waitForTimeout(700);
await page.click('.tab:text-is("Money")');
await page.waitForSelector('.balance');
check((await text()).includes('£'), 'currency symbol change applied everywhere');

// =====================================================================
// PIN lockout in the UI
// =====================================================================
await page.click('.topbar .btn:text-is("Lock")');
await page.waitForSelector('.picker');
for (let i = 0; i < 5; i++) {
  await page.click('.profile--parent');
  await page.waitForSelector('dialog .pin-key');
  await typePin('000000');
  await page.click('dialog .btn--primary');
  await page.waitForTimeout(300);
  await page.click('dialog .btn--ghost:text-is("Cancel")');
  await page.waitForTimeout(200);
}
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin(PIN);                       // the CORRECT pin
await page.click('dialog .btn--primary');
await page.waitForTimeout(500);
const lockMsg = await page.textContent('dialog .pin-error');
check(/too many/i.test(lockMsg), `correct PIN refused while locked ("${lockMsg}")`);
check(await page.locator('.tabs').count() === 0, 'did not get into the parent screen');
await page.screenshot({ path: `${SHOT}/13-locked.png` });

console.log('\n--- console errors ---');
console.log(errors.length ? errors.join('\n') : 'none');
if (errors.length) failures++;

console.log(`\n${failures === 0 ? 'ALL CONFIG TESTS PASSED' : `${failures} FAILURE(S)`}`);
await browser.close();
process.exit(failures ? 1 : 0);
