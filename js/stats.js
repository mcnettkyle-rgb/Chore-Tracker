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
    approved: 0, missed: 0, waiting: 0, upcoming: 0,
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
    s.total = s.decided + s.upcoming;
  }

  return byChild;
}

/** Blank figures, so a child with nothing scheduled still renders a card. */
export function emptySummary() {
  return {
    approved: 0, missed: 0, waiting: 0, upcoming: 0,
    earnedCents: 0, missedCents: 0, waitingCents: 0,
    decided: 0, rate: null, perfect: false, total: 0,
  };
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
 * The timeframe options on the dashboard. `all` has no bounds, which is what
 * makes lifetime totals and period totals agree.
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
