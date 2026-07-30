// The dashboard's arithmetic, tested without a browser.
//
// The definitions matter more than the sums. A completion rate that counts
// chores not yet due can never reach 100%, so a "perfect week" badge would be
// unachievable — and a badge you can't earn is worse than no badge.

import { summarise, ranges, rangeById, rangeProgress, effectiveDate } from '../js/stats.js';

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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL STATS TESTS PASSED');
process.exit(failures ? 1 : 0);
