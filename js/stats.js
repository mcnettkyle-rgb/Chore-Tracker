// Turning raw chore instances into the numbers on the parent dashboard.
//
// Kept out of the views and out of both adapters so there is exactly one
// definition of "completed", "missed" and "completion rate". Getting those
// definitions consistent matters more than the arithmetic: a completion rate
// that counts chores not yet due would never reach 100%, and a "perfect week"
// that can't be achieved is worse than no badge at all.

import { ymd, addDays, weekStartFor, daysBetween, parseYmd } from './util.js';

/**
 * The day a chore is really answerable for.
 *
 * Day-scheduled chores have a due date. Anytime and one-off chores don't —
 * they're owed by the end of their week, so that's the date they count on.
 */
export function effectiveDate(inst) {
  return inst.due_date ?? addDays(inst.week_start, 6);
}

/**
 * Has this chore's chance passed? Distinct from isExpired() in store.js, which
 * answers "can a kid still submit this right now" using the household's late
 * rules. For scoring a finished period, anything still unapproved after its
 * day has gone is a miss, whether or not late submission is allowed.
 */
function isPast(inst, today) {
  return effectiveDate(inst) < today;
}

/**
 * Per-child figures for a date range.
 *
 * A chore counts toward the rate once its day has passed, or once it has been
 * approved. Chores still ahead of their deadline are "pending" and sit outside
 * the rate entirely, so a rate shown mid-week reflects what has actually been
 * decided rather than being dragged down by work that isn't due yet.
 */
export function summarise(instances, { from, to, today = ymd() } = {}) {
  const inRange = instances.filter((i) => {
    const d = effectiveDate(i);
    return (!from || d >= from) && (!to || d <= to);
  });

  const byChild = new Map();
  const blank = () => ({
    approved: 0, missed: 0, waiting: 0, upcoming: 0, excused: 0,
    earnedCents: 0, missedCents: 0, waitingCents: 0,
  });

  for (const inst of inRange) {
    if (!byChild.has(inst.child_id)) byChild.set(inst.child_id, blank());
    const s = byChild.get(inst.child_id);

    if (inst.status === 'approved') {
      s.approved++;
      s.earnedCents += inst.value_cents;
    } else if (inst.status === 'submitted') {
      s.waiting++;
      s.waitingCents += inst.value_cents;
    } else if (inst.status === 'excused') {
      // A sleepover, a sick day, a week at grandma's. Counted separately and
      // deliberately kept out of `decided` below — this is the entire point of
      // the status. It is neither a success nor a failure, so it must not push
      // the rate in either direction.
      s.excused++;
    } else if (isPast(inst, today)) {
      // pending or rejected, and its day has gone
      s.missed++;
      s.missedCents += inst.value_cents;
    } else {
      s.upcoming++;
    }
  }

  for (const s of byChild.values()) {
    // Decided = everything that has had its chance. Work still awaiting your
    // approval counts as decided too; it isn't the kid's fault it's sitting
    // in your queue, and excluding it would make the rate jump around
    // depending on how quickly you review.
    s.decided = s.approved + s.missed + s.waiting;
    s.rate = s.decided ? (s.approved + s.waiting) / s.decided : null;
    s.perfect = s.decided > 0 && s.missed === 0;
    // Excused work is in the total so a fully-excused week reads as "away"
    // rather than "nothing was ever scheduled".
    s.total = s.decided + s.upcoming + s.excused;
  }

  return byChild;
}

/** Blank figures, so a child with nothing scheduled still renders a card. */
export function emptySummary() {
  return {
    approved: 0, missed: 0, waiting: 0, upcoming: 0, excused: 0,
    earnedCents: 0, missedCents: 0, waitingCents: 0,
    decided: 0, rate: null, perfect: false, total: 0,
  };
}

/**
 * How many days in a row this child has cleared everything due that day.
 *
 * Written for a kid to read, so the rules are the generous, obvious ones:
 *
 *   - A day counts only if something was actually due that day. Days with
 *     nothing scheduled are skipped, not counted and not breaking — a Sunday
 *     off must not end a streak.
 *   - Excused days are skipped the same way. Being away is not a failure, and
 *     a streak that dies because you went to grandma's is exactly the kind of
 *     unfairness this whole feature exists to prevent.
 *   - Submitted-but-not-yet-approved counts as done. The child finished their
 *     part; how fast a parent reviews is not their business.
 *   - Today is skipped rather than counted against them while it is still
 *     running, otherwise every streak reads as broken until the evening.
 *
 * Only dated chores count. An "anytime this week" chore has no single day to
 * attach to, so folding it in would break days it was never owed on.
 */
export function streakFor(instances, childId, { today = ymd() } = {}) {
  const byDay = new Map();
  for (const inst of instances) {
    if (inst.child_id !== childId || !inst.due_date) continue;
    if (inst.due_date > today) continue;
    if (!byDay.has(inst.due_date)) byDay.set(inst.due_date, []);
    byDay.get(inst.due_date).push(inst);
  }

  const done = (i) => ['approved', 'submitted'].includes(i.status);
  const verdict = (items) => {
    const live = items.filter((i) => i.status !== 'excused');
    if (!live.length) return 'skip';               // nothing owed, or all excused
    return live.every(done) ? 'clear' : 'broken';
  };

  const days = [...byDay.keys()].sort().reverse();  // newest first

  let current = 0;
  for (const day of days) {
    const v = verdict(byDay.get(day));
    if (day === today && v === 'broken') continue;  // still time left today
    if (v === 'skip') continue;
    if (v === 'broken') break;
    current++;
  }

  // Best run anywhere in the data we were given, oldest to newest.
  let best = 0;
  let run = 0;
  for (const day of [...days].reverse()) {
    const v = verdict(byDay.get(day));
    if (v === 'skip') continue;
    if (v === 'broken') { run = 0; continue; }
    run++;
    if (run > best) best = run;
  }

  return { current, best: Math.max(best, current) };
}

// ---------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------

function monthStart(dateStr) {
  const d = parseYmd(dateStr);
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}

function monthEnd(dateStr) {
  const d = parseYmd(dateStr);
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * The timeframe options on the dashboard.
 *
 * `all` is unbounded at the top and, once a fresh start has been declared,
 * starts at that date. So its "earned" figure can legitimately come in under
 * the card's "Lifetime earned", which is read straight from the ledger: a
 * start_fresh() that kept its money leaves earnings behind the line. That is
 * the intended reading of the two labels — "all time" means all the time you
 * have chosen to count, "lifetime" means every cent ever recorded.
 */
export function ranges(weekStartDay = 0, today = ymd(), historyStart = null) {
  const thisWeek = weekStartFor(today, weekStartDay);
  const lastWeek = addDays(thisWeek, -7);

  const thisMonth = monthStart(today);
  const lastMonthDay = addDays(thisMonth, -1);

  return [
    { id: 'this_week',  label: 'This week',  from: thisWeek, to: addDays(thisWeek, 6) },
    { id: 'last_week',  label: 'Last week',  from: lastWeek, to: addDays(lastWeek, 6) },
    { id: 'this_month', label: 'This month', from: thisMonth, to: monthEnd(today) },
    { id: 'last_month', label: 'Last month', from: monthStart(lastMonthDay), to: monthEnd(lastMonthDay) },
    // "All time" starts at the fresh-start date when there is one, so the
    // trial run you deliberately cleared doesn't reappear in the lifetime view.
    { id: 'all',        label: 'All time',   from: historyStart, to: null },
  ];
}

export function rangeById(id, weekStartDay = 0, today = ymd(), historyStart = null) {
  const all = ranges(weekStartDay, today, historyStart);
  return all.find((r) => r.id === id) ?? all[0];
}

/**
 * How much of the range is behind us — used to say "3 of 7 days" so a perfect
 * badge mid-period reads as provisional rather than final.
 */
export function rangeProgress(range, today = ymd()) {
  if (!range.from || !range.to) return null;
  const total = daysBetween(range.from, range.to) + 1;
  const elapsed = Math.min(total, Math.max(0, daysBetween(range.from, today) + 1));
  return { elapsed, total, complete: today > range.to };
}
