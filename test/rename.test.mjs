// Renaming a child must update every mention of them, including rotations.
// The rotation used to carry its own stored name, so renaming the kids left
// the schedule's assignee dropdown offering a group called by their old names.

import { launchBrowser } from './browser.mjs';
const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const PIN = '246810';
let fails = 0;
const check = (c, l) => { console.log(`${c ? 'PASS ' : 'FAIL '} ${l}`); if (!c) fails++; };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
const page = await ctx.newPage();
page.on('pageerror', e => { console.log('PAGEERROR', e.message); fails++; });
const typePin = async p => { for (const d of p) await page.click(`dialog .pin-key:text-is("${d}")`); };
const text = () => page.textContent('body').then(t => t.replace(/\s+/g, ' '));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');
await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN); await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN); await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

// Rename both kids, exactly as the user did.
await page.click('.tab:text-is("Settings")');
await page.waitForSelector('.check');
for (const [oldName, newName] of [['Ava', 'Shyann'], ['Mia', 'Lucina']]) {
  await page.click(`.row:has-text("${oldName}")`);
  await page.waitForSelector('dialog:has-text("Edit")');
  await page.fill('dialog input[placeholder="Name"]', newName);
  await page.click('dialog .btn--primary:text-is("Save")');
  await page.waitForTimeout(600);
}
check((await text()).includes('Shyann') && (await text()).includes('Lucina'), 'both children renamed');

// The rotation must now read with the NEW names everywhere.
await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');
const sched = await text();
check(!sched.includes('Ava') && !sched.includes('Mia'), 'schedule shows no stale "Ava"/"Mia"');
check(sched.includes('Shyann') && sched.includes('Lucina'), 'schedule shows the new names');

// And inside the chore editor's assignee dropdown — the exact screen reported.
await page.click('.row:has-text("Take out the trash")');
await page.waitForSelector('dialog:has-text("Edit chore")');
const options = await page.locator('dialog select >> nth=0 >> option').allTextContents();
console.log('   assignee options:', JSON.stringify(options));
check(!options.some(o => /Ava|Mia/.test(o)), 'assignee dropdown has no stale names');
check(options.some(o => o.includes('Shyann') && o.includes('Lucina') && o.includes('alternating')),
      'dropdown shows the rotation as "Shyann & Lucina (alternating)"');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL RENAME TESTS PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
