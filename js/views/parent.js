// The parent side: tab shell + the approval queue.
//
// The queue is the heart of the app. Nothing earns money until a chore
// leaves this screen with an Approve.

import { el, formatMoney, timeAgo, contrastOn } from '../util.js';
import { section, foldedSection, emptyState, childChip, promptDialog, confirmDialog } from '../ui.js';
import {
  state, setParentTab, currency, childById, exitParent, pendingQueue,
  parentAction, toast, schemaOutOfDate, EXPECTED_SCHEMA_VERSION,
} from '../store.js';
import { db } from '../data.js';
import { renderLedger } from './ledger.js';
import { renderSchedule } from './schedule.js';
import { renderSettings } from './settings.js';
import { renderStats } from './stats.js';

const TABS = [
  { id: 'queue',    label: 'To check' },
  { id: 'stats',    label: 'Progress' },
  { id: 'ledger',   label: 'Money' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

// ---------------------------------------------------------------------
// Approval queue
// ---------------------------------------------------------------------

async function approve(inst) {
  try {
    const res = await parentAction((token) => db.approveChore(token, inst.id));
    const amount = res?.amount_cents ?? inst.value_cents;
    toast(`Approved — ${formatMoney(amount, currency())} to ${childById(inst.child_id)?.name ?? 'them'}`, 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function reject(inst) {
  const note = await promptDialog({
    title: 'Send it back',
    label: 'What needs fixing? (optional)',
    hint: `${childById(inst.child_id)?.name ?? 'They'} will see this note next to the chore.`,
    placeholder: 'e.g. There are still clothes on the floor',
    confirmLabel: 'Send back',
    multiline: true,
  });
  if (note === null) return;   // cancelled

  try {
    await parentAction((token) => db.rejectChore(token, inst.id, note));
    toast('Sent back for another go');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function approveAll() {
  const queue = pendingQueue();
  const total = queue.reduce((sum, i) => sum + i.value_cents, 0);
  const ok = await confirmDialog({
    title: `Approve all ${queue.length}?`,
    message: `This pays out ${formatMoney(total, currency())} across ${new Set(queue.map((i) => i.child_id)).size} kid(s). You can still send an individual chore back afterwards.`,
    confirmLabel: 'Approve all',
  });
  if (!ok) return;

  try {
    const res = await parentAction((token) => db.approveAll(token, null));
    toast(`Approved ${res?.approved ?? queue.length} chores`, 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function reviewCard(inst) {
  const child = childById(inst.child_id);
  return el('div', { class: 'review' },
    el('div', { class: 'review__head' },
      el('span', { class: 'chore__emoji' }, inst.chore_emoji),
      el('div', { class: 'spread__grow' },
        el('div', { class: 'chore__name' }, inst.chore_name),
        el('div', { class: 'chore__note' },
          childChip(child, { size: 22 }),
          ' ',
          el('span', { class: 'muted' }, timeAgo(inst.submitted_at)),
        ),
      ),
      el('span', { class: 'chore__value' }, formatMoney(inst.value_cents, currency())),
    ),
    el('div', { class: 'review__actions' },
      el('button', { class: 'btn btn--danger btn--big', type: 'button', onclick: () => reject(inst) },
        '↻ Needs redo'),
      el('button', { class: 'btn btn--good btn--big', type: 'button', onclick: () => approve(inst) },
        '✓ Approve'),
    ),
  );
}

async function undoApproval(inst) {
  const child = childById(inst.child_id);
  const ok = await confirmDialog({
    title: 'Undo this?',
    message: `"${inst.chore_name}" goes back on ${child?.name ?? 'their'} list as not done, `
      + `and the ${formatMoney(inst.value_cents, currency())} comes off their balance. `
      + 'They see no note about it.',
    confirmLabel: 'Undo it',
  });
  if (!ok) return;

  try {
    await parentAction((token) => db.unapproveChore(token, inst.id));
    toast(`Undone — ${formatMoney(inst.value_cents, currency())} taken back`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/**
 * Chores approved this week, newest first.
 *
 * Exists because approving is otherwise a one-way door — and an auto-approve
 * chore pays the instant a kid taps it, so a mis-tap is permanent with nowhere
 * in the UI to reach it.
 */
function recentlyApproved() {
  return (state.snap?.instances ?? [])
    .filter((i) => i.status === 'approved')
    .sort((a, b) => String(b.reviewed_at ?? '').localeCompare(String(a.reviewed_at ?? '')))
    .slice(0, 12);
}

function approvedSection() {
  const done = recentlyApproved();
  if (!done.length) return null;

  const rows = el('div', { class: 'rows' });
  for (const inst of done) {
    const child = childById(inst.child_id);
    rows.append(
      el('div', { class: 'row' },
        el('span', { class: 'chore__emoji', style: { width: '38px', height: '38px', fontSize: '19px' } },
          inst.chore_emoji),
        el('span', { class: 'row__body' },
          el('span', { class: 'row__title', style: { display: 'block' } }, inst.chore_name),
          el('span', { class: 'row__meta', style: { display: 'block' } },
            `${child?.name ?? '—'} · ${timeAgo(inst.reviewed_at)}`),
        ),
        el('span', { class: 'chore__value' }, formatMoney(inst.value_cents, currency())),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => undoApproval(inst) }, 'Undo'),
      ),
    );
  }

  return foldedSection('Approved this week', `${done.length}`,
    el('p', { class: 'hint', style: { margin: '10px 2px' } },
      'Undo puts a chore back on the kid\'s list as not done and takes the money back. '
      + 'Use it for a mis-tap; use "Needs redo" in the queue when the work itself was the problem.'),
    rows,
  );
}

function renderQueue() {
  const queue = pendingQueue();
  const wrap = el('div');

  if (!queue.length) {
    wrap.append(emptyState('☕', 'Nothing to check', 'You are all caught up. Marked-done chores will show up here.'));
    const approved = approvedSection();
    if (approved) wrap.append(approved);
    return wrap;
  }

  const total = queue.reduce((sum, i) => sum + i.value_cents, 0);

  wrap.append(
    el('div', { class: 'banner' },
      el('span', {}, `${queue.length} waiting · ${formatMoney(total, currency())}`),
      el('span', { class: 'banner__spacer' }),
      el('button', { class: 'btn', type: 'button', onclick: approveAll }, 'Approve all'),
    ),
  );

  // Group by kid so you can work through one child at a time.
  const byChild = new Map();
  for (const inst of queue) {
    if (!byChild.has(inst.child_id)) byChild.set(inst.child_id, []);
    byChild.get(inst.child_id).push(inst);
  }

  for (const [childId, items] of byChild) {
    const child = childById(childId);
    const sum = items.reduce((s, i) => s + i.value_cents, 0);
    wrap.append(section(
      child?.name ?? 'Unknown',
      `${items.length} · ${formatMoney(sum, currency())}`,
      el('div', { class: 'stack' }, ...items.map(reviewCard)),
    ));
  }

  const approved = approvedSection();
  if (approved) wrap.append(approved);

  return wrap;
}

// ---------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------

export function renderParent() {
  const wrap = el('div');
  const waiting = pendingQueue().length;

  wrap.append(
    el('header', { class: 'topbar' },
      el('h1', { class: 'topbar__title' },
        'Parent',
        el('span', { class: 'topbar__sub' }, state.snap?.household?.name ?? ''),
      ),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: exitParent }, 'Lock'),
    ),
  );

  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  for (const tab of TABS) {
    const selected = state.parentTab === tab.id;
    const btn = el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      'aria-selected': String(selected),
      onclick: () => setParentTab(tab.id),
    }, tab.label);

    if (tab.id === 'queue' && waiting > 0) {
      btn.append(el('span', { class: 'tab__badge' }, String(waiting)));
    }
    tabs.append(btn);
  }
  wrap.append(tabs);

  // A database behind the app is the parent's to fix, and the fix is one
  // paste. Say that, instead of letting each screen fail its own way.
  if (schemaOutOfDate()) {
    wrap.append(
      el('div', { class: 'banner', style: { background: 'var(--redo-bg)', color: 'var(--redo)' } },
        el('span', {},
          `⚠️ Your database is out of date (version ${state.schemaVersion}, this app needs `,
          `${EXPECTED_SCHEMA_VERSION}). Some screens won't work until you re-run `,
          el('code', {}, 'supabase/schema.sql'),
          ' in the Supabase SQL Editor. Your data is not affected.'),
      ),
    );
  }

  if (!state.snap?.household?.pin_is_set) {
    wrap.append(
      el('div', { class: 'banner' },
        el('span', {}, '⚠️ No PIN set — anyone can open this screen.'),
        el('span', { class: 'banner__spacer' }),
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => setParentTab('settings'),
        }, 'Set a PIN'),
      ),
    );
  }

  if (state.parentTab === 'stats')         wrap.append(renderStats());
  else if (state.parentTab === 'ledger')   wrap.append(renderLedger());
  else if (state.parentTab === 'schedule') wrap.append(renderSchedule());
  else if (state.parentTab === 'settings') wrap.append(renderSettings());
  else                                     wrap.append(renderQueue());

  return wrap;
}
