// Parent dashboard: how each kid did over a chosen period, plus lifetime money.
//
// Built for one question — "does anyone deserve a reward this week?" — so the
// completion rate and the perfect-period badge are the loudest things on it.

import { el, formatMoney, contrastOn, formatWeekRange, ymd } from '../util.js';
import { section, emptyState } from '../ui.js';
import { state, setState, currency, settings, toast } from '../store.js';
import { db } from '../data.js';
import { summarise, emptySummary, ranges, rangeById, rangeProgress } from '../stats.js';

/** The date a fresh start was declared, if any. */
const historyStart = () => settings().history_start_date || null;

// Cached between renders so switching tabs doesn't refetch, and so a realtime
// update doesn't blank the screen while new figures load.
let cache = { key: null, data: null, loading: false };

function load(rangeId) {
  const range = rangeById(rangeId, settings().week_start_day ?? 0, ymd(), historyStart());
  const key = `${rangeId}:${range.from}:${range.to}:${state.dataVersion}`;
  if (cache.key === key || cache.loading) return;

  cache.loading = true;
  db.statsFor({ from: range.from, to: range.to })
    .then((data) => { cache = { key, data, loading: false }; setState({}); })
    .catch((err) => { cache.loading = false; toast(err.message, 'error'); });
}

function rateRing(rate, color) {
  const pct = rate === null ? 0 : Math.round(rate * 100);
  return el('div', { class: 'ring', style: { '--ring-pct': `${pct}`, '--ring-color': color } },
    el('div', { class: 'ring__label' },
      rate === null ? '—' : `${pct}%`),
  );
}

function childCard(child, s, lifetime, range, progress) {
  const sym = currency();
  const showPerfect = s.perfect && s.decided > 0;

  const head = el('div', { class: 'balance__top' },
    el('span', {
      class: 'profile__avatar',
      style: {
        background: child.color, color: contrastOn(child.color),
        width: '42px', height: '42px', fontSize: '22px',
      },
    }, child.emoji),
    el('div', { class: 'spread__grow' },
      el('div', { style: { fontWeight: '750', fontSize: '17px' } }, child.name),
      el('div', { class: 'balance__sub' },
        s.total === 0 ? 'Nothing scheduled'
          // A period spent entirely away is not the same as one with nothing
          // on the schedule, and "0 of 0 done" describes neither.
          : s.decided === 0 && s.excused > 0 ? 'Away for all of it'
          : `${s.approved + s.waiting} of ${s.decided} done`),
    ),
    showPerfect
      ? el('span', {
          class: 'pill pill--done',
          title: progress && !progress.complete
            ? 'Perfect so far — the period is still running'
            : 'No missed chores in this period',
        }, progress && !progress.complete ? '★ Perfect so far' : '★ Perfect')
      : null,
  );

  const figures = el('div', { class: 'figures' },
    el('div', { class: 'figure' },
      el('div', { class: 'figure__value', style: { color: 'var(--done)' } },
        formatMoney(s.earnedCents, sym)),
      el('div', { class: 'figure__label' }, 'Earned'),
    ),
    el('div', { class: 'figure' },
      el('div', { class: 'figure__value', style: { color: s.missed ? 'var(--redo)' : 'var(--ink-faint)' } },
        String(s.missed)),
      el('div', { class: 'figure__label' }, 'Missed'),
    ),
    el('div', { class: 'figure' },
      el('div', { class: 'figure__value', style: { color: s.waiting ? 'var(--waiting)' : 'var(--ink-faint)' } },
        String(s.waiting)),
      el('div', { class: 'figure__label' }, 'To check'),
    ),
    el('div', { class: 'figure' },
      el('div', { class: 'figure__value', style: { color: 'var(--ink-faint)' } }, String(s.upcoming)),
      el('div', { class: 'figure__label' }, 'Still to come'),
    ),
    // Only shown when there is one, so a normal week isn't cluttered by a
    // column of zeroes — but visible when it matters, because it explains why
    // the rate is based on fewer chores than the schedule called for.
    s.excused
      ? el('div', { class: 'figure' },
          el('div', { class: 'figure__value', style: { color: 'var(--ink-faint)' } }, String(s.excused)),
          el('div', { class: 'figure__label' }, 'Away'),
        )
      : null,
  );

  const missedNote = s.missed
    ? el('div', { class: 'hint', style: { margin: '2px' } },
        `${formatMoney(s.missedCents, sym)} left on the table.`)
    : null;

  return el('div', { class: 'balance' },
    head,
    el('div', { class: 'spread', style: { gap: '18px' } },
      rateRing(s.rate, child.color),
      el('div', { class: 'spread__grow' }, figures),
    ),
    missedNote,
    el('div', { class: 'lifetime' },
      el('span', {}, 'Lifetime'),
      el('strong', {}, `${formatMoney(lifetime.earned, sym)} earned`),
      el('span', { class: 'muted' }, '·'),
      el('span', {}, `${formatMoney(lifetime.paid, sym)} paid`),
      el('span', { class: 'muted' }, '·'),
      el('strong', { style: { color: 'var(--accent)' } }, `${formatMoney(lifetime.balance, sym)} owed`),
    ),
  );
}

export function renderStats() {
  const snap = state.snap;
  const sym = currency();
  const weekStartDay = settings().week_start_day ?? 0;
  const rangeId = state.statsRange ?? 'this_week';
  const range = rangeById(rangeId, weekStartDay, ymd(), historyStart());

  load(rangeId);

  const wrap = el('div');

  // ---- timeframe picker ----
  const picker = el('div', { class: 'tabs', style: { marginBottom: '14px' } });
  for (const r of ranges(weekStartDay, ymd(), historyStart())) {
    picker.append(el('button', {
      class: 'tab',
      type: 'button',
      'aria-selected': String(r.id === rangeId),
      onclick: () => setState({ statsRange: r.id }),
    }, r.label));
  }
  wrap.append(picker);

  // An open-ended range has no progress to report. Since a fresh start gives
  // "All time" a `from` but never a `to`, key this off `to` rather than `from`.
  const progress = rangeProgress(range);
  const caption = !range.to
    ? (historyStart() ? `Everything since ${historyStart()}` : 'Every chore ever scheduled')
    : progress.complete
      ? `${formatWeekRange(range.from)} · finished`
      : `${formatWeekRange(range.from)} · day ${progress.elapsed} of ${progress.total}`;

  wrap.append(el('p', { class: 'hint', style: { textAlign: 'center', marginTop: '0' } }, caption));

  // Keep showing the previous figures while a new range loads, rather than
  // flashing a spinner over numbers that are still broadly right.
  if (!cache.data) {
    wrap.append(el('div', { class: 'empty', style: { marginTop: '20px' } }, 'Working it out…'));
    return wrap;
  }

  const kids = (snap?.children ?? []).filter((c) => c.active);
  const byChild = summarise(cache.data.instances, { from: range.from, to: range.to });

  if (!kids.length) {
    wrap.append(emptyState('👧', 'No children yet', 'Add one in Settings.'));
    return wrap;
  }

  // ---- household totals ----
  let earned = 0, missed = 0, decided = 0, approved = 0, waiting = 0;
  for (const child of kids) {
    const s = byChild.get(child.id) ?? emptySummary();
    earned += s.earnedCents; missed += s.missed;
    decided += s.decided; approved += s.approved; waiting += s.waiting;
  }
  const householdRate = decided ? Math.round(((approved + waiting) / decided) * 100) : null;

  wrap.append(
    el('div', { class: 'summary' },
      el('div', { class: 'stat stat--earned' },
        el('div', { class: 'stat__label' }, 'Earned in this period'),
        el('div', { class: 'stat__value' }, formatMoney(earned, sym)),
      ),
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label' }, 'Completion'),
        el('div', { class: 'stat__value' }, householdRate === null ? '—' : `${householdRate}%`),
      ),
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label' }, 'Missed'),
        el('div', { class: 'stat__value', style: { color: missed ? 'var(--redo)' : undefined } },
          String(missed)),
      ),
      el('div', { class: 'stat' },
        el('div', { class: 'stat__label' }, 'Owed right now'),
        el('div', { class: 'stat__value' },
          formatMoney(kids.reduce((t, c) => t + (cache.data.lifetime[c.id]?.balance ?? 0), 0), sym)),
      ),
    ),
  );

  // ---- per child ----
  const cards = el('div', { class: 'balance-cards' });
  for (const child of kids) {
    const s = byChild.get(child.id) ?? emptySummary();
    const lifetime = cache.data.lifetime[child.id] ?? { earned: 0, paid: 0, adjusted: 0, balance: 0 };
    cards.append(childCard(child, s, lifetime, range, progress));
  }
  wrap.append(section(range.label, null, cards));

  wrap.append(
    el('p', { class: 'hint', style: { marginTop: '18px' } },
      'Completion counts every chore whose day has passed. Anything still ahead of its ',
      'deadline is left out, so a perfect record stays reachable mid-week. Chores waiting ',
      'in your approval queue count as done — the kid finished their part. Days marked ',
      'away are left out entirely, counting neither for nor against.'),
  );

  return wrap;
}
