// The parent side: tab shell + the approval queue.
//
// The queue is the heart of the app. Nothing earns money until a chore
// leaves this screen with an Approve.

import { el, formatMoney, timeAgo, contrastOn } from '../util.js';
import { section, emptyState, childChip, promptDialog, confirmDialog } from '../ui.js';
import {
  state, setState, currency, childById, exitParent, pendingQueue,
  parentAction, toast,
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

function renderQueue() {
  const queue = pendingQueue();
  const wrap = el('div');

  if (!queue.length) {
    wrap.append(emptyState('☕', 'Nothing to check', 'You are all caught up. Marked-done chores will show up here.'));
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
      onclick: () => setState({ parentTab: tab.id }),
    }, tab.label);

    if (tab.id === 'queue' && waiting > 0) {
      btn.append(el('span', { class: 'tab__badge' }, String(waiting)));
    }
    tabs.append(btn);
  }
  wrap.append(tabs);

  if (!state.snap?.household?.pin_is_set) {
    wrap.append(
      el('div', { class: 'banner' },
        el('span', {}, '⚠️ No PIN set — anyone can open this screen.'),
        el('span', { class: 'banner__spacer' }),
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => setState({ parentTab: 'settings' }),
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
