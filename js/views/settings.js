// Everything a parent can reconfigure without touching code.

import { el, contrastOn, ymd, DAY_NAMES } from '../util.js';
import { section, openDialog, confirmDialog, emptyState } from '../ui.js';
import { state, settings, parentAction, refresh, toast, exitParent } from '../store.js';
import { db, isDemo, CONFIG } from '../data.js';
import { openSetPin } from './pin.js';
import { pushSupported, pushEnabled, enablePush, disablePush } from '../push.js';

const COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5', '#65a30d'];
const AVATARS = ['🦊', '🐨', '🐼', '🦁', '🐧', '🦄', '🐢', '🐝', '🦉', '🐙', '⭐', '🌈'];

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

  // The server judges "is this chore late?" in this timezone. Getting it wrong
  // means chores due today are refused after UTC midnight — worth showing
  // plainly rather than leaving buried in a hint.
  const detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const storedZone = s.timezone || 'UTC';
  const zoneMatches = storedZone === detectedZone;

  const zoneRow = el('div', { class: 'field' },
    el('label', { class: 'field__label' }, 'Timezone'),
    el('div', { class: 'spread' },
      el('span', { style: { fontWeight: '650' } }, storedZone),
      zoneMatches
        ? el('span', { class: 'pill pill--done' }, '✓ matches this device')
        : el('button', {
            class: 'btn btn--primary', type: 'button',
            onclick: () => saveSetting({ timezone: detectedZone }),
          }, `Use ${detectedZone}`),
    ),
    el('div', { class: 'field__hint' },
      zoneMatches
        ? 'Used to decide what counts as "today" when a chore is marked done, and for quiet hours.'
        : `This device says ${detectedZone}. Until they match, chores due today can be refused `
          + 'as late once it turns midnight UTC — early evening in the Americas.'),
  );

  wrap.append(section('Rules', null,
    zoneRow,
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

  // ---- fresh start ----
  wrap.append(section('Going live', null,
    el('p', { class: 'field__hint', style: { marginTop: '0' } },
      s.history_start_date
        ? `Statistics currently count everything from ${s.history_start_date} onwards. `
          + 'Anything before that was cleared and will not come back.'
        : 'Setting the app up generates a week of chores nobody was actually asked to do, '
          + 'and those count as missed forever. Clear them the day you start for real.'),

    // Shown so a wrong value is visible rather than mysterious. Chores due
    // today are safe regardless — generate_week() clamps this to today — but
    // being able to see and clear it beats wondering.
    s.history_start_date
      ? el('div', { class: 'spread', style: { marginBottom: '12px' } },
          el('span', { class: 'muted' }, `Counting from ${s.history_start_date}`),
          el('button', {
            class: 'btn btn--ghost', type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Count everything again?',
                message: 'Statistics go back to including every chore still in the database. '
                  + 'Chores already deleted by a fresh start stay deleted.',
                confirmLabel: 'Clear the marker',
              });
              if (!ok) return;
              await saveSetting({ history_start_date: null });
            },
          }, 'Clear'),
        )
      : null,
    el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        const result = await openDialog({
          title: 'Start fresh',
          confirmLabel: 'Clear and start fresh',
          build: (body) => {
            const from = el('input', { type: 'date' });
            from.value = ymd();

            const wipe = el('input', { type: 'checkbox' });
            const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });

            body.append(
              el('p', { class: 'field__hint', style: { marginTop: '0' } },
                'Chores before this date that nobody ever did are deleted, and will not be '
                + 'regenerated. Your chore list, schedule, children and PIN are untouched.'),
              el('div', { class: 'field' },
                el('label', { class: 'field__label' }, 'Count statistics from'), from,
                el('div', { class: 'field__hint' }, 'Usually today — the first day you use it for real.'),
              ),
              el('label', { class: 'check' }, wipe,
                el('span', {},
                  el('span', { class: 'check__title' }, 'Also wipe test earnings and balances'),
                  el('span', { class: 'check__hint' },
                    'Deletes every approved chore before that date and the whole money history, '
                    + 'putting all balances back to zero. Leave this off to keep anything real.'),
                ),
              ),
              error,
            );

            return () => {
              if (!from.value) { error.textContent = 'Pick a date.'; return undefined; }
              return { from: from.value, wipe: wipe.checked };
            };
          },
        });
        if (!result) return;

        const ok = await confirmDialog({
          title: result.wipe ? 'Delete all money history?' : 'Clear unfinished chores?',
          message: result.wipe
            // start_fresh() clears the ledger outright, not just the part
            // before the date — say so, because this one cannot be undone.
            ? `Every balance goes to zero and the entire money history is deleted, including anything earned since ${result.from}. There is no undo.`
            : `Chores before ${result.from} that were never done are deleted. Approved chores and balances are kept.`,
          confirmLabel: result.wipe ? 'Delete everything' : 'Clear them',
        });
        if (!ok) return;

        try {
          const res = await parentAction((token) => db.startFresh(token, result.from, result.wipe));
          await db.generateWeek();
          await refresh();
          toast(`Cleared ${res?.chores_removed ?? 0} old chores`, 'good');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, s.history_start_date ? 'Start fresh again' : 'Clear test data and start fresh'),
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
