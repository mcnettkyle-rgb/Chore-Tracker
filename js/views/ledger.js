// Money: what each kid is owed, paying it out, and the running history.
//
// Balances carry forever. "Pay out" records that cash actually changed hands;
// it doesn't reset anything, so saving up works on its own.

import { el, formatMoney, parseMoney, formatDateTime, contrastOn } from '../util.js';
import { section, emptyState, openDialog } from '../ui.js';
import { state, currency, childById, balanceOf, parentAction, toast } from '../store.js';
import { db } from '../data.js';

function payoutDialog(child, balance) {
  const sym = currency();
  return openDialog({
    title: `Pay ${child.name}`,
    confirmLabel: 'Record payout',
    build: (body) => {
      const amount = el('input', {
        type: 'text', inputmode: 'decimal',
        value: (Math.max(0, balance) / 100).toFixed(2),
      });
      const note = el('input', { type: 'text', placeholder: 'e.g. cash, added to savings' });
      const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });

      body.append(
        el('p', { class: 'field__hint', style: { marginTop: '0' } },
          `${child.name} is owed ${formatMoney(balance, sym)}. Recording a payout subtracts it from the balance — it doesn't clear their chore history.`),
        el('div', { class: 'field' },
          el('label', { class: 'field__label' }, `Amount (${sym})`),
          amount,
        ),
        el('div', { class: 'field' },
          el('label', { class: 'field__label' }, 'Note (optional)'),
          note,
        ),
        error,
      );

      return () => {
        const cents = parseMoney(amount.value);
        if (cents === null || cents <= 0) {
          error.textContent = 'Enter an amount greater than zero.';
          return undefined;
        }
        return { cents, note: note.value.trim() };
      };
    },
  });
}

function adjustDialog(child) {
  const sym = currency();
  return openDialog({
    title: `Adjust ${child.name}'s balance`,
    confirmLabel: 'Apply',
    build: (body) => {
      const sign = el('select', {},
        el('option', { value: 'add' }, 'Add to balance'),
        el('option', { value: 'sub' }, 'Take off balance'),
      );
      const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '1.00' });
      const note = el('input', { type: 'text', placeholder: 'e.g. birthday money, broke a window' });
      const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });

      body.append(
        el('p', { class: 'field__hint', style: { marginTop: '0' } },
          'A one-off correction that has nothing to do with chores. It shows in the history with your note.'),
        el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'Direction'), sign),
        el('div', { class: 'field' }, el('label', { class: 'field__label' }, `Amount (${sym})`), amount),
        el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'Note'), note),
        error,
      );

      return () => {
        const cents = parseMoney(amount.value);
        if (cents === null || cents === 0) {
          error.textContent = 'Enter an amount greater than zero.';
          return undefined;
        }
        return { cents: sign.value === 'sub' ? -cents : cents, note: note.value.trim() };
      };
    },
  });
}

async function onPayout(child) {
  const balance = balanceOf(child.id);
  const result = await payoutDialog(child, balance);
  if (!result) return;
  try {
    await parentAction((token) => db.recordPayout(token, child.id, result.cents, result.note));
    toast(`Paid ${child.name} ${formatMoney(result.cents, currency())}`, 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onAdjust(child) {
  const result = await adjustDialog(child);
  if (!result) return;
  try {
    await parentAction((token) => db.adjustBalance(token, child.id, result.cents, result.note));
    toast('Balance adjusted', 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function renderLedger() {
  const sym = currency();
  const snap = state.snap;
  const wrap = el('div');

  const kids = (snap?.children ?? []).filter((c) => c.active);

  // ---- balance cards ----
  const cards = el('div', { class: 'balance-cards' });
  for (const child of kids) {
    const balance = balanceOf(child.id);
    const earnedThisWeek = (snap.instances ?? [])
      .filter((i) => i.child_id === child.id && i.status === 'approved')
      .reduce((sum, i) => sum + i.value_cents, 0);

    cards.append(
      el('div', { class: 'balance' },
        el('div', { class: 'balance__top' },
          el('span', {
            class: 'profile__avatar',
            style: {
              background: child.color, color: contrastOn(child.color),
              width: '40px', height: '40px', fontSize: '21px',
            },
          }, child.emoji),
          el('div', { class: 'spread__grow' },
            el('div', { style: { fontWeight: '700' } }, child.name),
            el('div', { class: 'balance__sub' }, `${formatMoney(earnedThisWeek, sym)} earned this week`),
          ),
        ),
        el('div', { class: 'balance__amount' }, formatMoney(balance, sym)),
        el('div', { class: 'spread' },
          el('button', {
            class: 'btn btn--primary spread__grow', type: 'button',
            disabled: balance <= 0,
            onclick: () => onPayout(child),
          }, 'Pay out'),
          el('button', { class: 'btn', type: 'button', onclick: () => onAdjust(child) }, 'Adjust'),
        ),
      ),
    );
  }
  wrap.append(cards);

  // ---- history ----
  const entries = snap?.recentLedger ?? [];
  if (!entries.length) {
    wrap.append(section('History', null,
      emptyState('📒', 'Nothing yet', 'Approved chores and payouts will show up here.')));
    return wrap;
  }

  const rows = el('div', { class: 'ledger' });
  for (const entry of entries) {
    const child = childById(entry.child_id);
    const positive = entry.amount_cents >= 0;
    const label = entry.type === 'payout' ? 'Paid out'
      : entry.type === 'adjustment' ? 'Adjustment'
      : entry.note || 'Chore';

    rows.append(
      el('div', { class: 'ledger__row' },
        el('span', {
          class: 'chore__emoji',
          style: {
            width: '36px', height: '36px', fontSize: '17px',
            background: `${child?.color ?? '#888'}22`,
          },
        }, entry.type === 'payout' ? '💵' : entry.type === 'adjustment' ? '✏️' : '✓'),
        el('div', { class: 'ledger__desc' },
          el('div', { class: 'ledger__title' }, label),
          el('div', { class: 'ledger__meta' },
            `${child?.name ?? '—'} · ${formatDateTime(entry.created_at)}`,
            entry.type !== 'earning' && entry.note ? ` · ${entry.note}` : '',
          ),
        ),
        el('span', { class: `ledger__amount ledger__amount--${positive ? 'pos' : 'neg'}` },
          `${positive ? '+' : ''}${formatMoney(entry.amount_cents, sym)}`),
      ),
    );
  }

  wrap.append(section('History', `${entries.length}`, rows));
  return wrap;
}
