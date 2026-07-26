// Everything a parent can reconfigure without touching code.

import { el, contrastOn, DAY_NAMES } from '../util.js';
import { section, openDialog, confirmDialog, emptyState } from '../ui.js';
import { state, settings, parentAction, refresh, toast, exitParent } from '../store.js';
import { db, isDemo, CONFIG } from '../data.js';
import { openSetPin } from './pin.js';
import { pushSupported, pushEnabled, enablePush, disablePush } from '../push.js';

const COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5', '#65a30d'];
const AVATARS = ['🦊', '🐨', '🐼', '🦁', '🐧', '🦄', '🐢', '🐝', '🦉', '🐙', '⭐', '🌈'];

// One-shot guard: the timezone auto-detect must not re-fire on every render.
let timezoneSynced = false;

async function saveSetting(patch) {
  try {
    await parentAction((token) => db.updateSettings(token, patch));
    toast('Saved', 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------

async function onEditChild(child) {
  const result = await openDialog({
    title: child ? `Edit ${child.name}` : 'Add a child',
    confirmLabel: 'Save',
    danger: child ? 'Remove' : null,
    build: (body) => {
      const name = el('input', { type: 'text', placeholder: 'Name' });
      name.value = child?.name ?? '';

      let color = child?.color ?? COLORS[0];
      let emoji = child?.emoji ?? AVATARS[0];

      const preview = el('span', { class: 'profile__avatar', style: { width: '64px', height: '64px', fontSize: '32px' } });
      const paint = () => {
        preview.style.background = color;
        preview.style.color = contrastOn(color);
        preview.textContent = emoji;
      };

      const colorRow = el('div', { class: 'days' });
      for (const c of COLORS) {
        colorRow.append(el('button', {
          class: 'chip chip--swatch', type: 'button',
          style: { background: c, borderColor: 'transparent' },
          'aria-label': `Colour ${c}`,
          onclick: () => { color = c; paint(); },
        }, ''));
      }

      const emojiRow = el('div', { class: 'days' });
      for (const e of AVATARS) {
        emojiRow.append(el('button', {
          class: 'chip chip--emoji', type: 'button',
          'aria-label': `Use ${e}`,
          onclick: () => { emoji = e; paint(); },
        }, e));
      }

      paint();

      const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });

      body.append(
        el('div', { class: 'spread', style: { marginBottom: '16px' } },
          preview,
          el('div', { class: 'field spread__grow', style: { marginBottom: '0' } },
            el('label', { class: 'field__label' }, 'Name'), name),
        ),
        el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'Colour'), colorRow),
        el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'Avatar'), emojiRow),
        error,
      );

      return () => {
        if (!name.value.trim()) { error.textContent = 'Enter a name.'; return undefined; }
        return { id: child?.id ?? null, name: name.value.trim(), color, emoji, active: true };
      };
    },
  });

  if (!result) return;

  if (result.__danger) {
    const ok = await confirmDialog({
      title: `Remove ${child.name}?`,
      message: 'They disappear from the picker and the schedule. Their balance and history are kept, so you can add them back later.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await parentAction((token) => db.upsertChild(token, { ...child, active: false }));
      toast('Removed');
    } catch (err) { toast(err.message, 'error'); }
    return;
  }

  try {
    await parentAction((token) => db.upsertChild(token, result));
    toast(child ? 'Saved' : 'Child added', 'good');
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

export function renderSettings() {
  const snap = state.snap;
  const s = settings();
  const wrap = el('div');

  // ---- children ----
  const childRows = el('div', { class: 'rows' });
  for (const child of snap.children.filter((c) => c.active)) {
    childRows.append(
      el('button', {
        class: 'row', type: 'button',
        style: { textAlign: 'left', border: '0', width: '100%', cursor: 'pointer' },
        onclick: () => onEditChild(child),
      },
        el('span', {
          class: 'chore__emoji',
          style: { width: '42px', height: '42px', fontSize: '21px', background: child.color, color: contrastOn(child.color) },
        }, child.emoji),
        el('span', { class: 'row__body' }, el('span', { class: 'row__title' }, child.name)),
        el('span', { class: 'muted' }, 'Edit'),
      ),
    );
  }

  wrap.append(section('Children', null,
    snap.children.some((c) => c.active) ? childRows : emptyState('👧', 'No children yet', 'Add one to get started.'),
    el('button', { class: 'btn', type: 'button', style: { marginTop: '12px' }, onclick: () => onEditChild(null) },
      '+ Add a child'),
  ));

  // ---- rules ----
  const weekStart = el('select', {});
  for (let i = 0; i < 7; i++) weekStart.append(el('option', { value: String(i) }, DAY_NAMES[i]));
  weekStart.value = String(s.week_start_day ?? 0);
  weekStart.addEventListener('change', () => saveSetting({ week_start_day: Number(weekStart.value) }));

  const symbol = el('input', { type: 'text', maxlength: '3', style: { maxWidth: '90px' } });
  symbol.value = s.currency_symbol ?? '$';
  symbol.addEventListener('change', () => saveSetting({ currency_symbol: symbol.value.trim() || '$' }));

  const allowLate = el('input', { type: 'checkbox' });
  allowLate.checked = s.allow_late_submission !== false;

  const graceDays = el('input', { type: 'number', min: '0', max: '14', style: { maxWidth: '110px' } });
  graceDays.value = String(s.late_grace_days ?? 3);
  graceDays.disabled = allowLate.checked;
  graceDays.addEventListener('change', () => saveSetting({ late_grace_days: Number(graceDays.value) || 0 }));

  allowLate.addEventListener('change', () => {
    graceDays.disabled = allowLate.checked;
    saveSetting({ allow_late_submission: allowLate.checked });
  });

  wrap.append(section('Rules', null,
    el('div', { class: 'field-row' },
      el('div', { class: 'field field--narrow' },
        el('label', { class: 'field__label' }, 'Week starts on'), weekStart,
        el('div', { class: 'field__hint' }, 'Changing this reshuffles which days chores land on.'),
      ),
      el('div', { class: 'field', style: { flex: '0 0 130px' } },
        el('label', { class: 'field__label' }, 'Currency'), symbol),
    ),
    el('label', { class: 'check' }, allowLate,
      el('span', {},
        el('span', { class: 'check__title' }, 'Allow late chores'),
        el('span', { class: 'check__hint' },
          'Kids can still mark a chore done after its day has passed. Turn this off to enforce the schedule.'),
      ),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field__label' }, 'Days of grace after the due date'),
      graceDays,
      el('div', { class: 'field__hint' }, 'Only used when late chores are switched off.'),
    ),
  ));

  // ---- notifications ----
  const notifChildren = [];

  if (isDemo) {
    notifChildren.push(
      el('p', { class: 'field__hint', style: { marginTop: '0' } },
        'Notifications need the Supabase backend — in demo mode there is no server to send them. ' +
        'The "To check" badge still works.'),
    );
  } else {
    const emailOn = el('input', { type: 'checkbox' });
    emailOn.checked = s.notify_email !== false;
    emailOn.addEventListener('change', () => saveSetting({ notify_email: emailOn.checked }));

    const emailTo = el('input', { type: 'email', placeholder: 'you@example.com' });
    emailTo.value = s.notify_email_to ?? '';
    emailTo.addEventListener('change', () => saveSetting({ notify_email_to: emailTo.value.trim() }));

    const pushOn = el('input', { type: 'checkbox' });
    pushOn.checked = s.notify_push !== false;
    pushOn.addEventListener('change', () => saveSetting({ notify_push: pushOn.checked }));

    // Quiet hours are evaluated server-side in the household's timezone, so
    // it has to be stored. Detect it once, from the parent's own browser.
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && (!s.timezone || s.timezone === 'UTC') && detected !== 'UTC' && !timezoneSynced) {
      timezoneSynced = true;
      parentAction((token) => db.updateSettings(token, { timezone: detected }))
        .catch(() => { timezoneSynced = false; });
    }

    const hourSelect = (value, onChange) => {
      const sel = el('select', { style: { maxWidth: '120px' } });
      for (let h = 0; h < 24; h++) {
        const label = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
        sel.append(el('option', { value: String(h) }, label));
      }
      sel.value = String(value);
      sel.addEventListener('change', () => onChange(Number(sel.value)));
      return sel;
    };

    const quietFrom = hourSelect(s.quiet_hours_start ?? 21, (v) => saveSetting({ quiet_hours_start: v }));
    const quietTo = hourSelect(s.quiet_hours_end ?? 7, (v) => saveSetting({ quiet_hours_end: v }));

    const deviceBtn = el('button', { class: 'btn', type: 'button' },
      pushEnabled() ? 'Turn off on this device' : 'Turn on for this device');
    deviceBtn.addEventListener('click', async () => {
      deviceBtn.disabled = true;
      try {
        if (pushEnabled()) {
          await disablePush();
          toast('Push turned off for this device');
        } else {
          await enablePush(state.parentToken);
          toast('This device will now get a ping', 'good');
        }
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        deviceBtn.disabled = false;
        await refresh();
      }
    });

    notifChildren.push(
      el('label', { class: 'check' }, pushOn,
        el('span', {},
          el('span', { class: 'check__title' }, 'Phone notification when a chore is marked done'),
          el('span', { class: 'check__hint' }, 'Needs turning on once per device, below.'),
        ),
      ),
      pushSupported()
        ? el('div', { class: 'field' }, deviceBtn,
            el('div', { class: 'field__hint' },
              'On an iPhone or iPad you must add this app to the home screen first — Safari only allows push from an installed app.'))
        : el('p', { class: 'field__hint' }, 'This browser does not support push notifications.'),
      el('label', { class: 'check' }, emailOn,
        el('span', {},
          el('span', { class: 'check__title' }, 'Email me as well'),
          el('span', { class: 'check__hint' }, 'A quieter fallback if push is unreliable.'),
        ),
      ),
      el('div', { class: 'field' },
        el('label', { class: 'field__label' }, 'Send email to'), emailTo),
      el('div', { class: 'field' },
        el('label', { class: 'field__label' }, 'Quiet hours (no push)'),
        el('div', { class: 'spread' },
          quietFrom, el('span', { class: 'muted' }, 'to'), quietTo,
        ),
        el('div', { class: 'field__hint' },
          `Push is held back during these hours; email still goes out. Times are in ${s.timezone || 'UTC'}. ` +
          'Set both to the same hour to disable.'),
      ),
    );
  }

  wrap.append(section('Notifications', null, ...notifChildren));

  // ---- security ----
  wrap.append(section('Parent PIN', null,
    el('p', { class: 'field__hint', style: { marginTop: '0' } },
      snap.household?.pin_is_set
        ? 'Required to approve chores, pay out, or change any of this. Five wrong tries locks it for five minutes.'
        : '⚠️ No PIN is set, so anyone can open this screen. Set one now.'),
    el('div', { class: 'spread' },
      el('button', {
        class: snap.household?.pin_is_set ? 'btn' : 'btn btn--primary',
        type: 'button',
        onclick: async () => {
          const pin = await openSetPin({
            title: snap.household?.pin_is_set ? 'Change parent PIN' : 'Set a parent PIN',
          });
          if (!pin) return;
          try {
            await parentAction((token) => db.setParentPin(token, pin));
            toast('PIN updated', 'good');
          } catch (err) { toast(err.message, 'error'); }
        },
      }, snap.household?.pin_is_set ? 'Change PIN' : 'Set a PIN'),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: exitParent }, 'Lock now'),
    ),
  ));

  // ---- demo tools ----
  if (isDemo) {
    wrap.append(section('Demo data', null,
      el('p', { class: 'field__hint', style: { marginTop: '0' } },
        'This browser is running the app on localStorage — nothing syncs to other devices. ' +
        'Resetting wipes it and reloads the sample chores.'),
      el('button', {
        class: 'btn btn--danger', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Reset demo data?',
            message: 'Every chore, approval and balance in this browser is deleted and replaced with the samples.',
            confirmLabel: 'Reset everything',
          });
          if (!ok) return;
          await db.resetDemo();
          await db.generateWeek();
          await refresh();
          toast('Demo data reset');
        },
      }, 'Reset demo data'),
    ));
  }

  wrap.append(
    el('p', { class: 'hint', style: { textAlign: 'center', marginTop: '30px' } },
      isDemo ? 'Running in demo mode (localStorage)' : `Connected to ${new URL(CONFIG.supabaseUrl).host}`),
  );

  return wrap;
}
