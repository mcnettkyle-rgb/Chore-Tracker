// The streak badge on a kid's own screen.
//
// All the encouraging feedback used to live on the parent's dashboard, where
// the kids never see it. This is the one piece of it on their screen.
//
// The arithmetic is covered exhaustively in stats.test.mjs, which is where the
// edge cases belong — this drives the real UI to check the badge is wired up,
// appears only when there's something to celebrate, and survives being away.
//
// Building a streak needs several days of finished history, which the seed
// doesn't have and the UI can't fabricate without time travel. In demo mode
// the whole database is one localStorage key, so the history is written there
// directly and the app is reloaded on top of it.

import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8765';
const KEY = 'chore-tracker-db-v1';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1400 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

/**
 * Mark every dated chore this child has on `days` with `status`.
 * Returns the child's name and how many days were actually touched.
 */
async function setHistory(days, status) {
  return page.evaluate(([key, days, status]) => {
    const db = JSON.parse(localStorage.getItem(key));
    const child = db.children[0];
    let touched = 0;
    for (const ci of db.chore_instances) {
      if (ci.child_id !== child.id || !ci.due_date) continue;
      if (!days.includes(ci.due_date)) continue;
      ci.status = status;
      ci.submitted_at = Date.now();
      ci.reviewed_at = Date.now();
      touched++;
    }
    localStorage.setItem(key, JSON.stringify(db));
    return { name: child.name, touched };
  }, [KEY, days, status]);
}

async function streak(name) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.picker');
  await page.waitForTimeout(600);

  // The picker chip and the kid's own badge read from one shared cache in the
  // store, so they must never disagree — captured together to prove it.
  const tile = page.locator(`.profile:has-text("${name}") .profile__streak`);
  const chip = await tile.count() ? ((await tile.textContent()) ?? '').trim() : null;

  await page.click(`.profile:has-text("${name}")`);
  await page.waitForSelector('.summary');
  await page.waitForTimeout(600);
  const present = await page.locator('.streak').count();
  const text = present ? ((await page.locator('.streak strong').textContent()) ?? '').trim() : null;
  const sub = present ? ((await page.locator('.streak__sub').textContent()) ?? '').trim() : null;
  await page.click('.topbar .btn:text-is("Switch")');
  await page.waitForSelector('.picker');
  return { present, text, sub, chip };
}

/** The number in a streak string, wherever it appears. */
const count = (s) => Number((String(s ?? '').match(/\d+/) ?? [0])[0]);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.picker');

const name = (await page.locator('.profile__name').allTextContents())[0].trim();

// ---- nothing finished yet: no badge ----
const none = await streak(name);
check(none.present === 0, 'no badge before anything has been finished');
check(none.chip === null, 'and no chip on the picker either');

// ---- one day done is not a streak worth shouting about ----
await setHistory([daysAgo(1)], 'approved');
const one = await streak(name);
check(one.present === 0, 'a single finished day still shows no badge');
check(one.chip === null, 'nor a picker chip — "1 day streak" is not an achievement');

// ---- three days in a row ----
const three = [daysAgo(1), daysAgo(2), daysAgo(3)];
const { touched } = await setHistory(three, 'approved');
check(touched > 0, `there is history to work with (${touched} chores over 3 days)`);

const run = await streak(name);
check(run.present === 1, 'three days in a row earns a badge');
check(/3 days in a row/.test(run.text ?? ''), `it says how long ("${run.text}")`);
check(/best/i.test(run.sub ?? ''), `and gives it context ("${run.sub}")`);

// ---- and it's visible from the picker, without opening a profile ----
check(run.chip !== null, 'the picker tile shows a streak chip');
check(/3/.test(run.chip ?? '') && /streak/i.test(run.chip ?? ''),
  `it reads as a streak ("${run.chip}")`);
check(count(run.chip) === count(run.text),
  `the tile and the kid's own badge agree (${count(run.chip)} vs ${count(run.text)})`);

// The other child has no history, so their tile must stay bare.
const otherName = (await page.locator('.profile__name').allTextContents())[1].trim();
const otherChip = page.locator(`.profile:has-text("${otherName}") .profile__streak`);
check(await otherChip.count() === 0, `${otherName} has no chip, having finished nothing`);

// ---- being away must not break it ----
//
// This is the interaction that matters. A streak that dies because a child
// went to grandma's is exactly the unfairness the excused status exists to
// prevent, and it would be very easy to get wrong here.
await setHistory([daysAgo(4)], 'excused');
await setHistory([daysAgo(5), daysAgo(6)], 'approved');

const acrossAway = await streak(name);
check(acrossAway.present === 1, 'the badge survives a day away');
check(/5 days in a row/.test(acrossAway.text ?? ''),
  `the excused day is skipped, not counted or fatal ("${acrossAway.text}")`);
check(count(acrossAway.chip) === 5, `the picker chip follows along ("${acrossAway.chip}")`);

// ---- a genuine miss does break it ----
await setHistory([daysAgo(2)], 'pending');
const broken = await streak(name);
check(/1 day|^$/.test(broken.text ?? '') || broken.present === 0,
  `a missed day cuts the streak back ("${broken.text ?? 'no badge'}")`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL STREAK TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
