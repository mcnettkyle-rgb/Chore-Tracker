// A kid's own screen: what to do today, what's waiting, what they've earned.
//
// Tap a chore to mark it done. Tap it again to undo, while it's still waiting.
// Nothing here can approve anything — the money only moves when a parent says so.

import {
  el, formatMoney, contrastOn, ymd, addDays, dayOfWeek, friendlyDay,
  formatLongDate, DAY_SHORT,
} from '../util.js';
import { section, foldedSection, emptyState } from '../ui.js';
import {
  state, currentChild, currency, goToPicker, instancesFor, balanceOf,
  kidAction, toast, isExpired, dueTodayCount, outstandingLabel,
  ensureStreaks, streakOf,
} from '../store.js';
import { db } from '../data.js';

/**
 * "🔥 6 days in a row". Only rendered once there's something to celebrate —
 * a streak of 0 or 1 shown as a badge reads as a scolding.
 *
 * The data comes from the store's shared cache, which the picker fills too, so
 * the tile and this badge cannot show different numbers.
 */
function streakBadge(childId) {
  const streak = streakOf(childId);
  if (!streak) return null;
  const { current, best } = streak;
  if (current < 2) return null;

  const isBest = current >= best;
  return el('div', { class: 'streak' },
    el('span', { class: 'streak__flame' }, '🔥'),
    el('span', {},
      el('strong', {}, `${current} days in a row`),
      el('span', { class: 'streak__sub' },
        isBest ? 'Your best ever!' : `Your best is ${best}`),
    ),
  );
}

/**
 * Progress towards whatever this child is saving for.
 *
 * "You have $14.25" is abstract at 8 and 10. "You're most of the way to the
 * roller skates" is not. Capped at 100% so reaching the goal reads as a win
 * rather than an overflowing bar.
 */
function goalBar(child, balance) {
  if (!child.goal_cents || child.goal_cents <= 0) return null;

  const pct = Math.min(100, Math.round((balance / child.goal_cents) * 100));
  const reached = balance >= child.goal_cents;
  const left = child.goal_cents - balance;
  const sym = currency();

  return el('div', { class: `goal${reached ? ' goal--reached' : ''}` },
    el('div', { class: 'goal__top' },
      el('span', { class: 'goal__label' },
        reached ? '🎉 ' : '🎯 ',
        child.goal_label || 'Saving up'),
      el('span', { class: 'goal__figures' },
        `${formatMoney(Math.min(balance, child.goal_cents), sym)} of ${formatMoney(child.goal_cents, sym)}`),
    ),
    el('div', { class: 'goal__track' },
      el('div', { class: 'goal__fill', style: { width: `${pct}%`, background: child.color } })),
    el('div', { class: 'goal__note' },
      reached
        ? "You've saved enough — ask about cashing it in!"
        : `${formatMoney(left, sym)} to go`),
  );
}

/**
 * When this chore is due, in words a kid can act on. Every card gets one —
 * without it, "must be done today" and "due Friday" look identical in a list.
 */
function duePill(inst, weekEnd) {
  if (inst.due_date === null) {
    // Anytime chores still have a real deadline: the end of the week.
    return { text: `By ${DAY_SHORT[dayOfWeek(weekEnd)]}`, cls: 'pill--muted' };
  }
  const today = ymd();
  if (inst.due_date === today) return { text: 'Today', cls: 'pill--today' };
  if (inst.due_date < today) return { text: friendlyDay(inst.due_date), cls: 'pill--redo' };
  return { text: friendlyDay(inst.due_date), cls: 'pill--muted' };
}

function choreCard(inst, { onTap = null, tone = '', weekEnd = null } = {}) {
  const sym = currency();
  const today = ymd();
  const isMissed = tone === 'expired';
  // "LATE" means "you can still do this" — pointless once it's in Missed, and
  // wrong on a bonus job, which was never owed on a particular day.
  const overdue = !isMissed && !inst.is_bonus && inst.due_date && inst.due_date < today
    && ['pending', 'rejected'].includes(inst.status);

  const classes = ['chore'];
  if (tone) classes.push(`chore--${tone}`);
  if (overdue) classes.push('chore--overdue');

  const right = el('div', { class: 'chore__right' });
  right.append(el('span', { class: 'chore__value' }, formatMoney(inst.value_cents, sym)));

  if (inst.status === 'excused') {
    right.append(el('span', { class: 'pill pill--muted' }, '🌴 Day off'));
  } else if (isMissed) {
    right.append(el('span', { class: 'pill pill--muted' }, friendlyDay(inst.due_date)));
  } else if (inst.status === 'submitted') {
    right.append(el('span', { class: 'pill pill--waiting' }, '⏳ Waiting'));
  } else if (inst.status === 'approved') {
    right.append(el('span', { class: 'pill pill--done' }, '✓ Earned'));
  } else if (inst.is_bonus) {
    if (inst.status === 'rejected') right.append(el('span', { class: 'pill pill--redo' }, '↻ Try again'));
    right.append(el('span', { class: 'pill pill--bonus' }, '💎 Bonus'));
    // A bonus job that repeats is several separate chances at the money, one
    // per day, and they are otherwise indistinguishable — a daily one renders
    // as seven identical cards. The day says which is which. Deliberately
    // muted and never "LATE": it identifies, it doesn't chase.
    if (inst.due_date) {
      right.append(el('span', { class: 'pill pill--muted' }, friendlyDay(inst.due_date)));
    }
  } else {
    // Still to do (pending or sent back) — always say when it's due.
    if (inst.status === 'rejected') right.append(el('span', { class: 'pill pill--redo' }, '↻ Try again'));
    const due = duePill(inst, weekEnd);
    right.append(el('span', { class: `pill ${due.cls}` }, due.text));
  }

  const note = isMissed
    ? 'Ran out of time'
    : inst.status === 'rejected' && inst.review_note
      ? inst.review_note
      : inst.status === 'submitted'
        ? 'Marked done — tap to undo'
        : null;

  const body = el('div', { class: 'chore__body' },
    el('div', { class: 'chore__name' }, inst.chore_name),
    note ? el('div', { class: 'chore__note' }, note) : null,
  );

  return el('button', {
    class: classes.join(' '),
    type: 'button',
    disabled: !onTap,
    onclick: onTap ?? undefined,
  },
    el('span', { class: 'chore__emoji' }, inst.chore_emoji),
    body,
    right,
  );
}

async function markDone(inst) {
  try {
    const res = await kidAction(() => db.submitChore(inst.id));
    if (res?.auto) toast(`Nice! ${formatMoney(inst.value_cents, currency())} earned`, 'good');
    else toast('Marked done — waiting to be checked', 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function undo(inst) {
  try {
    await kidAction(() => db.unsubmitChore(inst.id));
    toast('Undone');
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function renderKid() {
  const child = currentChild();
  if (!child) {
    goToPicker();
    return el('div');
  }

  const sym = currency();
  const today = ymd();
  const mine = instancesFor(child.id);

  ensureStreaks();

  // Chores whose window has closed can't be submitted any more, so they must
  // not sit in the to-do list looking tappable.
  const expired   = mine.filter(isExpired);
  const live      = mine.filter((i) => !isExpired(i));

  const rejected  = live.filter((i) => i.status === 'rejected' && !i.is_bonus);
  const submitted = live.filter((i) => i.status === 'submitted');
  const approved  = live.filter((i) => i.status === 'approved');
  // Optional extra money. Kept out of every "you still owe this" bucket below
  // and given its own section, so passing on one is genuinely free.
  const pending   = live.filter((i) => i.status === 'pending' && !i.is_bonus);
  const bonus     = live.filter((i) => ['pending', 'rejected'].includes(i.status) && i.is_bonus);
  // Days a parent said didn't count. Shown, so the week still makes sense, but
  // folded away and never presented as something left to do.
  const excused   = live.filter((i) => i.status === 'excused');

  // Four buckets, each answering a different question for the kid:
  // what have I let slip, what must happen today, what has all week, what's coming.
  const overdue  = pending.filter((i) => i.due_date !== null && i.due_date < today);
  const dueToday = pending.filter((i) => i.due_date === today);
  const anytime  = pending.filter((i) => i.due_date === null);
  const upcoming = pending.filter((i) => i.due_date !== null && i.due_date > today);

  const weekEnd = addDays(state.snap.weekStart, 6);
  const earnedThisWeek  = approved.reduce((sum, i) => sum + i.value_cents, 0);
  const waitingThisWeek = submitted.reduce((sum, i) => sum + i.value_cents, 0);

  // "Today" counts only chores actually due today. Anytime-this-week chores
  // used to be lumped in here, which made the ring impossible to finish: doing
  // one moved the numerator but it was never really a today job.
  //
  // The remaining count comes from the same helper the profile picker uses, so
  // the tile and this header always agree.
  // Excused chores are left out of both halves of the ring. Counting them in
  // the total would make the day unfinishable; counting them as done would
  // credit work nobody did. They simply aren't part of today.
  const scheduledToday = mine.filter(
    (i) => i.due_date === today && !isExpired(i) && i.status !== 'excused' && !i.is_bonus,
  );
  const totalToday = scheduledToday.length;
  const remainingToday = dueTodayCount(child.id);
  const doneToday = totalToday - remainingToday;

  const wrap = el('div');

  // ---- header ----
  wrap.append(
    el('header', { class: 'topbar' },
      el('span', {
        class: 'profile__avatar',
        style: {
          background: child.color, color: contrastOn(child.color),
          width: '52px', height: '52px', fontSize: '27px',
        },
      }, child.emoji),
      el('h1', { class: 'topbar__title' },
        `Hi ${child.name}!`,
        el('span', { class: 'topbar__sub' }, outstandingLabel(child.id)),
      ),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: goToPicker }, 'Switch'),
    ),
  );

  // ---- stats ----
  const progress = totalToday ? Math.round((doneToday / totalToday) * 100) : 100;
  wrap.append(
    el('div', { class: 'summary' },
      el('div', { class: 'stat stat--earned' },
        el('div', { class: 'stat__label' }, 'Earned this week'),
        el('div', { class: 'stat__value' }, formatMoney(earnedThisWeek, sym)),
      ),
      el('div', { class: 'stat stat--waiting' },
        el('div', { class: 'stat__label' }, 'Waiting'),
        el('div', { class: 'stat__value' }, formatMoney(waitingThisWeek, sym)),
      ),
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label' }, 'Your money'),
        el('div', { class: 'stat__value' }, formatMoney(balanceOf(child.id), sym)),
      ),
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label' }, 'Today'),
        el('div', { class: 'stat__value' }, `${doneToday}/${totalToday}`),
        el('div', { class: 'progress' },
          el('div', { class: 'progress__fill', style: { width: `${progress}%` } })),
      ),
    ),
  );

  // ---- saving up, and the streak ----
  // Both sit directly under the money so the numbers above them mean
  // something: this is what the earning is FOR, and this is the run they're
  // trying not to break.
  const goal = goalBar(child, balanceOf(child.id));
  if (goal) wrap.append(goal);

  const streak = streakBadge(child.id);
  if (streak) wrap.append(streak);

  // ---- needs another look ----
  if (rejected.length) {
    wrap.append(section('Needs another look', `${rejected.length}`,
      el('div', { class: 'chores' },
        ...rejected.map((i) => choreCard(i, { tone: 'rejected', onTap: () => markDone(i), weekEnd })),
      ),
    ));
  }

  // ---- overdue but still allowed ----
  // Only ever appears while "Allow late chores" is on; otherwise these have
  // already moved to Missed.
  if (overdue.length) {
    wrap.append(section('Catch up', `${overdue.length}`,
      el('div', { class: 'chores' },
        ...overdue
          .sort((a, b) => a.due_date.localeCompare(b.due_date))
          .map((i) => choreCard(i, { onTap: () => markDone(i), weekEnd })),
      ),
    ));
  }

  // ---- due today ----
  // Kept apart from "anytime" on purpose: these are the ones that stop
  // counting if today ends without them being done.
  if (dueToday.length) {
    wrap.append(section('Due today', `${formatLongDate(today)} · ${dueToday.length}`,
      el('div', { class: 'chores' },
        ...dueToday.map((i) => choreCard(i, { onTap: () => markDone(i), weekEnd })),
      ),
    ));
  }

  // ---- no fixed day, but must land before the week is out ----
  if (anytime.length) {
    wrap.append(section('Anytime this week', `by ${formatLongDate(weekEnd)} · ${anytime.length}`,
      el('div', { class: 'chores' },
        ...anytime.map((i) => choreCard(i, { onTap: () => markDone(i), weekEnd })),
      ),
    ));
  }

  if (!overdue.length && !dueToday.length && !anytime.length) {
    wrap.append(section('To do', null,
      expired.length
        // Don't say "all caught up" when the only reason the list is empty is
        // that the chores ran out of time.
        ? emptyState('🕐', 'Nothing you can do right now',
            'The ones below ran out of time. New chores appear on their day.')
        : emptyState('🎉', 'All caught up!', 'Nothing left to do right now.'),
    ));
  }

  // ---- bonus jobs ----
  // Deliberately NOT folded away, and placed after the real work rather than
  // before it. These are meant to be tempting once the actual chores are done,
  // not a distraction from them — and nothing here is ever counted as owed.
  if (bonus.length) {
    const worth = bonus.reduce((sum, i) => sum + i.value_cents, 0);
    wrap.append(section('Bonus jobs 💎', `${bonus.length} · ${formatMoney(worth, sym)}`,
      el('p', { class: 'hint', style: { margin: '0 2px 10px' } },
        'Extra jobs for extra money. Totally up to you — skipping one costs you '
        + 'nothing and never breaks your streak.'),
      el('div', { class: 'chores' },
        // Undated first, then by day: a repeating bonus job is one card per
        // day, and jumbled dates make seven near-identical rows unreadable.
        ...bonus
          .slice()
          .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
          .map((i) => choreCard(i, { tone: 'bonus', onTap: () => markDone(i), weekEnd })),
      ),
    ));
  }

  // ---- waiting ----
  if (submitted.length) {
    wrap.append(section('Waiting to be checked', `${submitted.length}`,
      el('div', { class: 'chores' },
        ...submitted.map((i) => choreCard(i, { tone: 'submitted', onTap: () => undo(i), weekEnd })),
      ),
    ));
  }

  // ---- coming up (folded: not actionable today) ----
  if (upcoming.length) {
    const worth = upcoming.reduce((sum, i) => sum + i.value_cents, 0);
    wrap.append(foldedSection('Later this week', `${upcoming.length} · ${formatMoney(worth, sym)}`,
      el('div', { class: 'chores' },
        ...upcoming
          .sort((a, b) => a.due_date.localeCompare(b.due_date))
          .map((i) => choreCard(i, { weekEnd })),
      ),
    ));
  }

  // ---- missed (folded: visible, but out of the way and not tappable) ----
  if (expired.length) {
    const lost = expired.reduce((sum, i) => sum + i.value_cents, 0);
    wrap.append(foldedSection('Missed', `${expired.length} · ${formatMoney(lost, sym)}`,
      el('p', { class: 'hint', style: { margin: '10px 2px' } },
        "These ran out of time and can't be done now. They start fresh next week."),
      el('div', { class: 'chores' },
        ...expired
          .sort((a, b) => a.due_date.localeCompare(b.due_date))
          .map((i) => choreCard(i, { tone: 'expired' })),
      ),
    ));
  }

  // ---- away (folded: explains a gap in the week without nagging) ----
  if (excused.length) {
    wrap.append(foldedSection('Days off', `${excused.length}`,
      el('p', { class: 'hint', style: { margin: '10px 2px' } },
        "These don't count — you weren't expected to do them."),
      el('div', { class: 'chores' },
        ...excused.map((i) => choreCard(i, { tone: 'excused', weekEnd })),
      ),
    ));
  }

  // ---- done (folded: nice to look back on, but not the job) ----
  if (approved.length) {
    wrap.append(foldedSection('Finished this week', `${approved.length} · ${formatMoney(earnedThisWeek, sym)}`,
      el('div', { class: 'chores' },
        ...approved.map((i) => choreCard(i, { tone: 'approved' })),
      ),
    ));
  }

  return wrap;
}
