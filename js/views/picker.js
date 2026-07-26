// "Who's here?" — the first thing anyone sees.
//
// One tap for a kid. The parent tile is PIN-gated.

import { el, formatMoney, contrastOn, ymd } from '../util.js';
import { emptyState } from '../ui.js';
import { state, chooseChild, enterParent, currency, toast, refresh } from '../store.js';
import { db, isDemo } from '../data.js';
import { openPinPad, openSetPin } from './pin.js';

function choresLeftToday(childId) {
  const today = ymd();
  return (state.snap?.instances ?? []).filter(
    (i) => i.child_id === childId &&
           ['pending', 'rejected'].includes(i.status) &&
           (i.due_date === null || i.due_date <= today),
  ).length;
}

async function onParentTap() {
  const result = await openPinPad({
    title: state.snap?.household?.pin_is_set ? 'Parent PIN' : 'Set up parent access',
    subtitle: state.snap?.household?.pin_is_set
      ? null
      : 'No PIN yet — tap any four digits to get in, then choose a real one.',
  });
  if (!result) return;

  enterParent(result.token);

  // First run: make them pick a PIN immediately, or the door stays open.
  if (result.needsPinSetup) {
    const pin = await openSetPin({
      title: 'Choose a parent PIN',
      subtitle: 'This is what keeps the girls out of the approvals screen. Pick 4–10 digits.',
    });
    if (pin) {
      try {
        await db.setParentPin(result.token, pin);
        await refresh();
        toast('PIN set', 'good');
      } catch (err) {
        toast(err.message, 'error');
      }
    } else {
      toast('No PIN set yet — anyone can open the parent screen. Set one in Settings.', 'error');
    }
  }
}

export function renderPicker() {
  const snap = state.snap;
  const wrap = el('div', { class: 'picker' });

  wrap.append(
    el('div', {},
      el('h1', { class: 'picker__title' }, "Who's here?"),
      el('p', { class: 'picker__hint' }, snap?.household?.name ?? 'Chores'),
    ),
  );

  const grid = el('div', { class: 'picker__grid' });
  const kids = (snap?.children ?? []).filter((c) => c.active);

  if (!kids.length) {
    wrap.append(emptyState('👋', 'No kids set up yet', 'Open the parent screen to add them.'));
  }

  for (const child of kids) {
    const left = choresLeftToday(child.id);
    grid.append(
      el('button', {
        class: 'profile',
        type: 'button',
        onclick: () => chooseChild(child.id),
        style: { borderColor: `${child.color}44` },
      },
        el('span', {
          class: 'profile__avatar',
          style: { background: child.color, color: contrastOn(child.color) },
        }, child.emoji),
        el('span', { class: 'profile__name' }, child.name),
        el('span', { class: 'profile__meta' },
          left === 0 ? 'All done today 🎉' : `${left} to do today`),
      ),
    );
  }

  const waiting = (snap?.pendingInstances ?? []).length;
  grid.append(
    el('button', { class: 'profile profile--parent', type: 'button', onclick: onParentTap },
      el('span', { class: 'profile__avatar' }, '🔒'),
      el('span', { class: 'profile__name' }, 'Parent'),
      el('span', { class: 'profile__meta' },
        waiting === 0 ? 'Nothing to check' : `${waiting} to check`),
    ),
  );

  wrap.append(grid);

  if (isDemo) {
    wrap.append(
      el('p', { class: 'hint', style: { maxWidth: '440px', margin: '4px auto 0' } },
        'Demo mode — everything is stored in this browser only, and nothing syncs between devices. ',
        'See the README to connect Supabase for real tablet sync.'),
    );
  }

  return wrap;
}
