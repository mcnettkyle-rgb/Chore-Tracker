// Adding a chore whose name matches one that already exists.
//
// upsert_chore() in schema.sql returns the new chore's id, but LocalAdapter's
// upsertChore() returned nothing — so the two adapters disagreed about what an
// upsert gives back. The schedule editor worked around that by saving the
// chore, refetching everything, and finding it again BY NAME.
//
// Two chores sharing a name is all it takes to break that: find() returns the
// older one, so the new chore's assignments were silently attached to the
// existing chore. The new chore ends up on nobody's list, the old one quietly
// gains a second owner, and nothing reports an error.
//
// The fix is for both adapters to return the id, so nothing has to guess.

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

// Already in the seed, assigned to both kids as an "anytime" chore.
const NAME = 'Tidy your bedroom';

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

const kids = (await page.locator('.profile__name').allTextContents()).map((n) => n.trim());
const second = kids[1];

await page.click('.profile--parent');
await page.waitForSelector('dialog .pin-key');
await typePin('1111'); await page.click('dialog .btn--primary'); await page.waitForTimeout(500);
await typePin(PIN);   await page.click('dialog .btn--primary'); await page.waitForTimeout(200);
await typePin(PIN);   await page.click('dialog .btn--primary');
await page.waitForSelector('.tabs');

await page.click('.tab:text-is("Schedule")');
await page.waitForSelector('.grid-table');

const rowsNamed = () => page.locator(`.row:has(.row__title:text-is("${NAME}"))`);
const before = await rowsNamed().count();
check(before === 1, `the seed has exactly one "${NAME}" to collide with`);

const originalMeta = ((await rowsNamed().first().locator('.row__meta').textContent()) ?? '').trim();

// ---- add a SECOND chore with the same name ----
await page.click('.btn--primary:text-is("+ Add a chore")');
await page.waitForSelector('dialog:has-text("New chore")');
await page.fill('dialog input[placeholder="e.g. Load the dishwasher"]', NAME);
await page.fill('dialog input[placeholder="0.50"]', '9.99');
await page.selectOption('dialog select >> nth=0', { label: second });
await page.click('dialog .btn--primary:text-is("Save")');
await page.waitForTimeout(1000);

const after = await rowsNamed().count();
check(after === 2, `both chores named "${NAME}" are listed (found ${after})`);

// The new chore is the one worth 9.99. It must own the assignment we just made.
const newRow = page.locator(`.row:has(.row__title:text-is("${NAME}")):has-text("9.99")`);
check(await newRow.count() === 1, 'the new chore is on the schedule at its own price');

const newMeta = ((await newRow.locator('.row__meta').textContent()) ?? '').trim();
check(!/not assigned/i.test(newMeta),
  `the new chore has an assignee, not "${newMeta}"`);
check(newMeta.includes(second),
  `the new chore is assigned to ${second} ("${newMeta}")`);

// ...and the original must be untouched.
const originalRow = page.locator(`.row:has(.row__title:text-is("${NAME}")):not(:has-text("9.99"))`);
const nowMeta = ((await originalRow.locator('.row__meta').textContent()) ?? '').trim();
check(nowMeta === originalMeta,
  `the original chore is unchanged ("${nowMeta}" vs "${originalMeta}")`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL DUPLICATE-NAME TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
