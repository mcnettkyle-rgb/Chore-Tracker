// The dashboard's arithmetic, tested without a browser.
//
// The definitions matter more than the sums. A completion rate that counts
// chores not yet due can never reach 100%, so a "perfect week" badge would be
// unachievable — and a badge you can't earn is worse than no badge.

import { summarise, streakFor, ranges, rangeById, rangeProgress, effectiveDate } from '../js/stats.js';

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}`);
  if (!cond) failures++;
};

const KID = 'kid-1';
let n = 0;
const chore = (status, due, value = 100, extra = {}) => ({
  id: `i${n++}`, child_id: KID, status,
  due_date: due, week_start: extra.week_start ?? '2026-07-26',
  value_cents: value, ...extra,
});

const TODAY = '2026-07-29';           // a Wednesday
const WEEK = { from: '2026-07-26', to: '2026-08-01' };
const get = (map) => map.get(KID);

// ---------------------------------------------------------------------
console.log('--- effective date ---');
check(effectiveDate(chore('pending', '2026-07-27')) === '2026-07-27',
  'a dated chore counts on its due date');
check(effectiveDate({ due_date: null, week_start: '2026-07-26' }) === '2026-08-01',
  'an anytime chore counts on the last day of its week');

// ---------------------------------------------------------------------
console.log('\n--- completion rate ---');
{
  const s = get(summarise([
    chore('approved', '2026-07-26'),
    chore('approved', '2026-07-27'),
    chore('pending',  '2026-07-28'),   // day gone, never done -> missed
    chore('pending',  '2026-07-31'),   // still ahead -> not counted yet
  ], { ...WEEK, today: TODAY }));

  check(s.approved === 2, 'counts approved chores');
  check(s.missed === 1, 'a past-dated pending chore is missed');
  check(s.upcoming === 1, 'a future chore is upcoming, not missed');
  check(s.decided === 3, 'only decided chores form the denominator');
  check(Math.round(s.rate * 100) === 67, `rate is 2/3 = 67% (got ${Math.round(s.rate * 100)}%)`);
  check(s.perfect === false, 'not perfect with a miss');
  check(s.earnedCents === 200, 'earnings sum only approved chores');
  check(s.missedCents === 100, 'missed value is tracked separately');
}

// ---------------------------------------------------------------------
console.log('\n--- work awaiting your approval ---');
{
  const s = get(summarise([
    chore('approved',  '2026-07-26'),
    chore('submitted', '2026-07-27'),   // kid did it; sitting in your queue
  ], { ...WEEK, today: TODAY }));

  check(s.waiting === 1, 'submitted chores are counted as waiting');
  check(s.rate === 1, 'a chore awaiting review does not count against the kid');
  check(s.perfect === true, 'still a perfect record while you have work to review');
  check(s.earnedCents === 100, 'waiting work is not counted as earned yet');
  check(s.waitingCents === 100, 'waiting value is reported separately');
}

// ---------------------------------------------------------------------
console.log('\n--- perfect period ---');
{
  const all = summarise([
    chore('approved', '2026-07-26'),
    chore('approved', '2026-07-27'),
    chore('pending',  '2026-07-31'),   // not due yet
  ], { ...WEEK, today: TODAY });
  check(get(all).perfect === true, 'perfect so far, with chores still to come');
  check(get(all).rate === 1, 'rate is 100% when nothing has been missed');
}
{
  const none = summarise([chore('pending', '2026-07-31')], { ...WEEK, today: TODAY });
  check(get(none).perfect === false, 'nothing decided yet is NOT a perfect period');
  check(get(none).rate === null, 'rate is null rather than 0 when nothing is decided');
}

// ---------------------------------------------------------------------
console.log('\n--- rejected chores ---');
{
  const s = get(summarise([
    chore('rejected', '2026-07-26'),   // sent back, day has passed
    chore('rejected', '2026-07-31'),   // sent back, still time to redo
  ], { ...WEEK, today: TODAY }));
  check(s.missed === 1, 'a rejected chore past its day is missed');
  check(s.upcoming === 1, 'a rejected chore with time left is not yet missed');
}

// ---------------------------------------------------------------------
console.log('\n--- range filtering ---');
{
  const map = summarise([
    chore('approved', '2026-07-20', 100, { week_start: '2026-07-19' }),  // week before
    chore('approved', '2026-07-27'),
    chore('approved', '2026-08-05', 100, { week_start: '2026-08-02' }),  // week after
  ], { ...WEEK, today: TODAY });
  check(get(map).approved === 1, 'chores outside the range are excluded');
}
{
  const map = summarise([
    chore('approved', '2026-07-20', 100, { week_start: '2026-07-19' }),
    chore('approved', '2026-07-27'),
  ], { from: null, to: null, today: TODAY });
  check(get(map).approved === 2, 'a null range means all time');
}

// ---------------------------------------------------------------------
console.log('\n--- multiple children ---');
{
  const map = summarise([
    { ...chore('approved', '2026-07-26'), child_id: 'a' },
    { ...chore('pending',  '2026-07-26'), child_id: 'b' },
  ], { ...WEEK, today: TODAY });
  check(map.get('a').rate === 1 && map.get('b').rate === 0, 'children are scored independently');
}

// ---------------------------------------------------------------------
console.log('\n--- timeframes ---');
{
  const rs = ranges(0, TODAY);
  const byId = Object.fromEntries(rs.map((r) => [r.id, r]));

  check(rs.length === 5, 'five timeframe options');
  check(byId.this_week.from === '2026-07-26' && byId.this_week.to === '2026-08-01',
    'this week spans Sunday to Saturday');
  check(byId.last_week.from === '2026-07-19' && byId.last_week.to === '2026-07-25',
    'last week is the seven days before');
  check(byId.this_month.from === '2026-07-01' && byId.this_month.to === '2026-07-31',
    'this month covers the whole calendar month');
  check(byId.last_month.from === '2026-06-01' && byId.last_month.to === '2026-06-30',
    'last month handles a 30-day month');
  check(byId.all.from === null && byId.all.to === null, 'all time is unbounded');

  // Monday-start households must shift, not break.
  const mon = Object.fromEntries(ranges(1, TODAY).map((r) => [r.id, r]));
  check(mon.this_week.from === '2026-07-27', 'week start day is respected');

  // Year boundary.
  const jan = Object.fromEntries(ranges(0, '2026-01-05').map((r) => [r.id, r]));
  check(jan.last_month.from === '2025-12-01' && jan.last_month.to === '2025-12-31',
    'last month crosses into the previous year');

  check(rangeById('nonsense', 0, TODAY).id === 'this_week', 'an unknown id falls back to this week');
}

// ---------------------------------------------------------------------
console.log('\n--- range progress ---');
{
  const p = rangeProgress({ from: '2026-07-26', to: '2026-08-01' }, TODAY);
  check(p.total === 7, 'a week is seven days');
  check(p.elapsed === 4, `four days elapsed by Wednesday (got ${p.elapsed})`);
  check(p.complete === false, 'the current week is not complete');

  const done = rangeProgress({ from: '2026-07-19', to: '2026-07-25' }, TODAY);
  check(done.complete === true, 'a finished week reports complete');
  check(rangeProgress({ from: null, to: null }, TODAY) === null, 'all time has no progress');
}

// ---------------------------------------------------------------------
// Excused chores. The whole reason the status exists is that it must not move
// the completion rate in either direction — a child away for three days is
// neither succeeding nor failing on those days.
console.log('\n--- excused chores ---');
{
  const s = get(summarise([
    chore('approved', '2026-07-26'),
    chore('approved', '2026-07-27'),
    chore('excused',  '2026-07-28'),
    chore('excused',  '2026-07-29'),
  ], { ...WEEK, today: TODAY }));

  check(s.excused === 2, 'excused chores are counted separately');
  check(s.decided === 2, 'they are NOT part of what has been decided');
  check(s.rate === 1, 'so a week with two days away is still 100%');
  check(s.perfect === true, 'and still counts as perfect');
  check(s.missedCents === 0, 'no money is recorded as left on the table');
  check(s.total === 4, 'but the week still knows about all four chores');
}
{
  // The failure this replaces: without the status, those days were misses.
  const asMisses = get(summarise([
    chore('approved', '2026-07-26'),
    chore('approved', '2026-07-27'),
    chore('pending',  '2026-07-28'),
    chore('pending',  '2026-07-29'),
  ], { ...WEEK, today: '2026-07-30' }));
  check(asMisses.rate === 0.5,
    `left as pending the same week scores 50% (got ${asMisses.rate})`);
}
{
  const allAway = get(summarise([
    chore('excused', '2026-07-27'),
    chore('excused', '2026-07-28'),
  ], { ...WEEK, today: TODAY }));
  check(allAway.rate === null, 'a fully excused week has no rate rather than 0%');
  check(allAway.perfect === false, 'and claims no perfect badge it did not earn');
  check(allAway.total === 2, 'it still reads as "away", not "nothing scheduled"');
}

// ---------------------------------------------------------------------
// Bonus chores are pure upside: they pay when done and cost nothing when they
// aren't. A hard optional job that punishes you for skipping it is not a
// bonus, it's just another chore, and kids work that out immediately.
console.log('\n--- bonus chores ---');
const bonus = (status, due, value = 500) => chore(status, due, value, { is_bonus: true });
{
  // Skipping a bonus job must cost nothing at all.
  const s = get(summarise([
    chore('approved', '2026-07-26'),
    chore('approved', '2026-07-27'),
    bonus('pending',  '2026-07-28'),   // day gone, never done
  ], { ...WEEK, today: TODAY }));

  check(s.rate === 1, `an untouched bonus job leaves the rate at 100% (got ${s.rate})`);
  check(s.missed === 0, 'it is not counted as missed');
  check(s.missedCents === 0, 'and no money is "left on the table"');
  check(s.perfect === true, 'a perfect week stays perfect');
  check(s.decided === 2, 'it never enters what has been decided');
  check(s.bonus === 1, 'but it is counted as offered');
  check(s.bonusDone === 0, 'and as not taken');
}
{
  // Doing one pays, but must not inflate the score either — a rate over 100%
  // would stop meaning anything.
  const s = get(summarise([
    chore('approved', '2026-07-26'),
    chore('pending',  '2026-07-27'),   // a genuine miss
    bonus('approved', '2026-07-28'),
  ], { ...WEEK, today: TODAY }));

  check(s.rate === 0.5, `finishing a bonus job does not pad the rate (got ${s.rate})`);
  check(s.approved === 1, 'it is not counted among the required chores done');
  check(s.bonusDone === 1, 'it is counted as a bonus taken');
  check(s.earnedCents === 600, `its money still counts (got ${s.earnedCents})`);
  check(s.bonusEarnedCents === 500, 'and is attributable as bonus earnings');
}
{
  // A week of nothing but bonus jobs has no rate to report.
  const s = get(summarise([bonus('pending', '2026-07-27')], { ...WEEK, today: TODAY }));
  check(s.rate === null, 'a bonus-only week has no rate rather than 0%');
  check(s.total === 1, 'but it still knows something was offered');
  check(s.upcoming === 0, 'a bonus job is not "still to come" either');
}

// ---------------------------------------------------------------------
console.log('\n--- streaks ---');
{
  const day = (d) => `2026-07-${String(d).padStart(2, '0')}`;
  const on = (d, status) => chore(status, day(d));

  check(streakFor([on(27, 'approved'), on(28, 'approved'), on(29, 'approved')], KID,
    { today: day(29) }).current === 3, 'three cleared days in a row is a streak of 3');

  check(streakFor([on(27, 'approved'), on(28, 'pending'), on(29, 'approved')], KID,
    { today: day(29) }).current === 1, 'a missed day breaks it');

  // A day with nothing scheduled must not end a run.
  check(streakFor([on(26, 'approved'), on(28, 'approved'), on(29, 'approved')], KID,
    { today: day(29) }).current === 3, 'a day with no chores is skipped, not a break');

  // The unfairness this feature exists to avoid.
  check(streakFor([on(26, 'approved'), on(27, 'excused'), on(28, 'excused'), on(29, 'approved')], KID,
    { today: day(29) }).current === 2, 'being away does not break a streak');

  // Waiting on a parent is not the kid's fault.
  check(streakFor([on(27, 'approved'), on(28, 'submitted'), on(29, 'approved')], KID,
    { today: day(29) }).current === 3, 'submitted-but-unreviewed counts as done');

  // Today is still running.
  check(streakFor([on(27, 'approved'), on(28, 'approved'), on(29, 'pending')], KID,
    { today: day(29) }).current === 2, 'an unfinished today does not break the streak yet');

  check(streakFor([on(29, 'approved')], KID, { today: day(29) }).current === 1,
    'a single cleared day is a streak of 1');

  // Every chore that day has to be done.
  check(streakFor([on(28, 'approved'), { ...on(28, 'pending'), id: 'x' }, on(29, 'approved')], KID,
    { today: day(29) }).current === 1, 'one unfinished chore breaks that day');

  // Best is remembered even after a break.
  const both = streakFor([
    on(20, 'approved'), on(21, 'approved'), on(22, 'approved'), on(23, 'approved'),
    on(24, 'pending'),
    on(28, 'approved'), on(29, 'approved'),
  ], KID, { today: day(29) });
  check(both.current === 2, `current run is 2 (got ${both.current})`);
  check(both.best === 4, `best run is remembered as 4 (got ${both.best})`);

  // Anytime chores have no day to attach to.
  check(streakFor([{ ...on(29, 'approved'), due_date: null }], KID, { today: day(29) }).current === 0,
    'anytime chores are left out of streaks');

  // Another child's chores are not mine.
  check(streakFor([{ ...on(29, 'pending'), child_id: 'someone-else' }], KID,
    { today: day(29) }).current === 0, 'only this child\'s chores count');

  check(streakFor([], KID, { today: day(29) }).current === 0, 'no history is a streak of 0');

  // Passing on a bonus job must never break a run, or bonus work becomes
  // something to fear rather than reach for.
  const skipped = { ...on(28, 'pending'), id: 'b1', is_bonus: true };
  check(streakFor([on(27, 'approved'), skipped, on(28, 'approved'), on(29, 'approved')], KID,
    { today: day(29) }).current === 3, 'an untouched bonus job does not break a streak');

  // A day with ONLY a bonus job on it is a day off, not a failure.
  check(streakFor([
    on(27, 'approved'),
    { ...on(28, 'pending'), id: 'b2', is_bonus: true },
    on(29, 'approved'),
  ], KID, { today: day(29) }).current === 2,
    'a day holding only an unclaimed bonus job is skipped, not fatal');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL STATS TESTS PASSED');
process.exit(failures ? 1 : 0);
