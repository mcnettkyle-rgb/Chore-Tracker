// The weekly schedule: what's planned, plus the editors for chores,
// who does them, and when.
//
// The mental model on this screen is "a chore, and who does it when" — so
// one dialog edits the chore and all of its assignments together, rather
// than making you visit two separate lists.

import {
  el, formatMoney, parseMoney, ymd, addDays, weekStartFor, dayOfWeek,
  formatWeekRange, formatLongDate, DAY_INITIAL, DAY_SHORT, uuid,
} from '../util.js';
import { section, emptyState, openDialog, confirmDialog } from '../ui.js';
import {
  state, settings, currency, childById, parentAction, toast, goToWeek, thisWeekStart,
} from '../store.js';
import { db } from '../data.js';

const SUGGESTED_EMOJI = ['🛏️', '🧼', '🗑️', '🧹', '🐕', '🍽️', '🧺', '📚', '🧸', '🪥', '🚿', '🌱', '📦', '🚗', '✅'];

/**
 * Who a rotation currently covers, worked out from its members rather than its
 * stored name — rename a child and every mention of the rotation follows,
 * instead of a label going quietly stale.
 *
 * `separator` is '&' when naming the group and '→' when the order matters.
 */
export function rotationLabel(group, separator = '&') {
  const names = (group?.child_ids ?? [])
    .map((id) => childById(id)?.name)
    .filter(Boolean);
  if (!names.length) return group?.name || 'Rotation';
  return names.join(` ${separator} `);
}

// ---------------------------------------------------------------------
// Assignment editor row
// ---------------------------------------------------------------------

/** Returns { node, read() } — read() gives back the assignment or null if removed. */
function assignmentRow(existing, { children, groups, onRemove }) {
  const weekStartDay = settings().week_start_day ?? 0;
  const removed = { value: false };

  const assignee = el('select', {});
  for (const c of children) {
    assignee.append(el('option', { value: `child:${c.id}` }, c.name));
  }
  for (const g of groups) {
    assignee.append(el('option', { value: `group:${g.id}` }, `${rotationLabel(g)} (alternating)`));
  }
  assignee.value = existing?.rotation_group_id
    ? `group:${existing.rotation_group_id}`
    : `child:${existing?.child_id ?? children[0]?.id}`;

  const type = el('select', {},
    el('option', { value: 'weekly_days' }, 'On certain days'),
    el('option', { value: 'anytime' }, 'Anytime this week'),
    el('option', { value: 'oneoff' }, 'Just once, this week'),
  );
  type.value = existing?.schedule_type ?? 'weekly_days';

  // Day-of-week toggles, ordered from the household's week start.
  const selectedDays = new Set(existing?.days_of_week ?? [1, 2, 3, 4, 5]);
  const days = el('div', { class: 'days' });
  const dayButtons = [];
  for (let offset = 0; offset < 7; offset++) {
    const dow = (weekStartDay + offset) % 7;
    const btn = el('button', {
      class: 'day-toggle',
      type: 'button',
      'aria-pressed': String(selectedDays.has(dow)),
      title: DAY_SHORT[dow],
      onclick: () => {
        if (selectedDays.has(dow)) selectedDays.delete(dow);
        else selectedDays.add(dow);
        btn.setAttribute('aria-pressed', String(selectedDays.has(dow)));
      },
    }, DAY_INITIAL[dow]);
    dayButtons.push(btn);
    days.append(btn);
  }

  const daysField = el('div', { class: 'field' },
    el('label', { class: 'field__label' }, 'Which days'),
    days,
  );

  const syncVisibility = () => {
    daysField.style.display = type.value === 'weekly_days' ? '' : 'none';
  };
  type.addEventListener('change', syncVisibility);
  syncVisibility();

  const node = el('div', {
    class: 'field',
    style: { border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '13px', gap: '12px' },
  },
    el('div', { class: 'field-row' },
      el('div', { class: 'field', style: { marginBottom: '0' } },
        el('label', { class: 'field__label' }, 'Who'), assignee),
      el('div', { class: 'field', style: { marginBottom: '0' } },
        el('label', { class: 'field__label' }, 'When'), type),
    ),
    daysField,
    el('button', {
      class: 'btn btn--ghost', type: 'button',
      style: { justifySelf: 'start' },
      onclick: () => { removed.value = true; node.remove(); onRemove?.(); },
    }, '× Remove'),
  );

  return {
    node,
    read() {
      if (removed.value) return null;
      const [kind, id] = assignee.value.split(':');
      const scheduleType = type.value;
      if (scheduleType === 'weekly_days' && selectedDays.size === 0) {
        return { __error: 'Pick at least one day, or switch to "anytime this week".' };
      }
      return {
        id: existing?.id ?? null,
        child_id: kind === 'child' ? id : null,
        rotation_group_id: kind === 'group' ? id : null,
        schedule_type: scheduleType,
        days_of_week: scheduleType === 'weekly_days' ? [...selectedDays].sort() : [],
        oneoff_week: scheduleType === 'oneoff' ? thisWeekStart() : null,
        active: true,
      };
    },
  };
}

// ---------------------------------------------------------------------
// Chore editor
// ---------------------------------------------------------------------

function choreDialog(chore) {
  const snap = state.snap;
  const children = snap.children.filter((c) => c.active);
  const groups = snap.rotationGroups ?? [];
  const existingAssignments = chore
    ? snap.assignments.filter((a) => a.chore_id === chore.id && a.active)
    : [];

  return openDialog({
    title: chore ? 'Edit chore' : 'New chore',
    confirmLabel: 'Save',
    danger: chore ? 'Archive' : null,
    wide: true,
    build: (body) => {
      const name = el('input', { type: 'text', placeholder: 'e.g. Load the dishwasher' });
      name.value = chore?.name ?? '';

      const emoji = el('input', { type: 'text', maxlength: '4', style: { width: '84px', textAlign: 'center', fontSize: '24px' } });
      emoji.value = chore?.emoji ?? '✅';

      const value = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.50' });
      value.value = chore ? (chore.value_cents / 100).toFixed(2) : '0.50';

      const description = el('input', { type: 'text', placeholder: 'What "done" looks like' });
      description.value = chore?.description ?? '';

      const autoApprove = el('input', { type: 'checkbox' });
      autoApprove.checked = !!chore?.auto_approve;

      const emojiRow = el('div', { class: 'days', style: { marginTop: '6px' } });
      for (const e of SUGGESTED_EMOJI) {
        emojiRow.append(el('button', {
          class: 'chip chip--emoji', type: 'button',
          'aria-label': `Use ${e}`,
          onclick: () => { emoji.value = e; },
        }, e));
      }

      const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });

      body.append(
        el('div', { class: 'field-row' },
          el('div', { class: 'field', style: { flex: '0 0 auto' } },
            el('label', { class: 'field__label' }, 'Icon'), emoji),
          el('div', { class: 'field' },
            el('label', { class: 'field__label' }, 'Name'), name),
          el('div', { class: 'field', style: { flex: '0 0 130px' } },
            el('label', { class: 'field__label' }, `Worth (${currency()})`), value),
        ),
        emojiRow,
        el('div', { class: 'field', style: { marginTop: '14px' } },
          el('label', { class: 'field__label' }, 'Description (optional)'), description),
        el('label', { class: 'check' },
          autoApprove,
          el('span', {},
            el('span', { class: 'check__title' }, 'Pay without checking'),
            el('span', { class: 'check__hint' },
              'Skips your approval queue and pays the moment it\'s marked done. For chores you don\'t need to inspect.'),
          ),
        ),
      );

      // ---- assignments ----
      const list = el('div', { class: 'stack' });
      const rows = [];

      const addRow = (existing) => {
        const row = assignmentRow(existing, { children, groups, onRemove: () => {} });
        rows.push(row);
        list.append(row.node);
      };

      for (const a of existingAssignments) addRow(a);

      body.append(
        el('h3', { style: { fontSize: '15px', fontWeight: '750', margin: '20px 0 8px' } }, 'Who does it, and when'),
        list,
        el('button', {
          class: 'btn', type: 'button', style: { marginTop: '10px' },
          onclick: () => addRow(null),
        }, '+ Add someone'),
        error,
      );

      if (!existingAssignments.length) addRow(null);

      return () => {
        const trimmed = name.value.trim();
        if (!trimmed) { error.textContent = 'Give the chore a name.'; return undefined; }

        const cents = parseMoney(value.value);
        if (cents === null) { error.textContent = 'Enter what it\'s worth, like 0.50'; return undefined; }

        const assignments = [];
        for (const row of rows) {
          const read = row.read();
          if (read === null) continue;
          if (read.__error) { error.textContent = read.__error; return undefined; }
          assignments.push(read);
        }
        if (!assignments.length) {
          error.textContent = 'Assign the chore to at least one person.';
          return undefined;
        }

        return {
          chore: {
            id: chore?.id ?? null,
            name: trimmed,
            emoji: emoji.value.trim() || '✅',
            description: description.value.trim(),
            value_cents: cents,
            auto_approve: autoApprove.checked,
            active: true,
          },
          assignments,
          removedIds: existingAssignments
            .filter((a) => !assignments.some((n) => n.id === a.id))
            .map((a) => a.id),
        };
      };
    },
  });
}

async function onEditChore(chore) {
  const result = await choreDialog(chore);
  if (!result) return;

  // "Archive" came back from the danger button.
  if (result.__danger) {
    const ok = await confirmDialog({
      title: `Archive "${chore.name}"?`,
      message: 'It disappears from the schedule from now on. Already-earned money and history are kept.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    try {
      await parentAction(async (token) => {
        for (const a of state.snap.assignments.filter((x) => x.chore_id === chore.id && x.active)) {
          await db.deleteAssignment(token, a.id);
        }
        await db.upsertChore(token, { ...chore, active: false });
      });
      toast('Chore archived');
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  try {
    await parentAction(async (token) => {
      // Both adapters return the row's id, which is the only reliable way to
      // attach the assignments to the chore we just saved. Looking it up by
      // name instead put them on the wrong chore whenever two shared a name.
      const choreId = await db.upsertChore(token, result.chore);
      if (!choreId) throw new Error('Could not find the chore after saving.');

      for (const id of result.removedIds) await db.deleteAssignment(token, id);
      for (const a of result.assignments) await db.upsertAssignment(token, { ...a, chore_id: choreId });
      await db.generateWeek(ymd());
    });
    toast(chore ? 'Chore updated' : 'Chore added', 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Rotation groups
// ---------------------------------------------------------------------

async function onEditGroup(group) {
  const children = state.snap.children.filter((c) => c.active);

  const result = await openDialog({
    title: group ? 'Edit rotation' : 'New rotation',
    confirmLabel: 'Save',
    build: (body) => {
      const chosen = new Set(group?.child_ids ?? children.map((c) => c.id));
      const boxes = [];

      // No name field on purpose. A rotation is identified everywhere by who is
      // currently in it, so renaming a child updates every mention of it. A
      // stored name would be a second source of truth that goes stale the
      // moment you rename someone — which is exactly what used to happen.
      body.append(
        el('p', { class: 'field__hint', style: { marginTop: '0' } },
          'A rotation alternates a chore between kids, one week each, in the order below. ' +
          'Assign a chore to the rotation instead of to one kid and it swaps automatically every week.'),
        el('div', { class: 'field__label', style: { marginBottom: '8px' } }, 'Who alternates'),
      );

      for (const child of children) {
        const box = el('input', { type: 'checkbox' });
        box.checked = chosen.has(child.id);
        boxes.push({ child, box });
        body.append(el('label', { class: 'check' }, box,
          el('span', {}, el('span', { class: 'check__title' }, `${child.emoji} ${child.name}`))));
      }

      const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });
      body.append(error);

      return () => {
        const ids = boxes.filter((b) => b.box.checked).map((b) => b.child.id);
        if (ids.length < 2) { error.textContent = 'Pick at least two kids to alternate between.'; return undefined; }
        // `name` is NOT NULL in the schema, so store the member names. Nothing
        // reads it back for display — rotationLabel() derives that live.
        const label = boxes.filter((b) => b.box.checked).map((b) => b.child.name).join(' & ');
        return { id: group?.id ?? null, name: label, child_ids: ids };
      };
    },
  });

  if (!result) return;
  try {
    await parentAction((token) => db.upsertRotationGroup(token, result));
    toast(group ? 'Rotation updated' : 'Rotation added', 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Away days
// ---------------------------------------------------------------------

/**
 * "Ava is at grandma's Friday to Sunday."
 *
 * Excusing is the missing third option next to approve and send-back. Without
 * it the only ways to handle a day a child was never asked about were to
 * reject the chores — which means "you did this badly" and shows them a note —
 * or to let the days score as misses, which quietly wrecks the completion rate
 * the reward mechanic depends on.
 */
async function onMarkAway() {
  const snap = state.snap;
  const kids = snap.children.filter((c) => c.active);
  if (!kids.length) return;

  const result = await openDialog({
    title: 'Mark someone away',
    confirmLabel: 'Excuse these chores',
    build: (body) => {
      const who = el('select', {});
      for (const c of kids) who.append(el('option', { value: c.id }, `${c.emoji} ${c.name}`));

      const from = el('input', { type: 'date', value: ymd() });
      const to = el('input', { type: 'date', value: ymd() });
      const error = el('div', { class: 'pin-error', style: { textAlign: 'left' } });

      body.append(
        el('p', { class: 'field__hint', style: { marginTop: '0' } },
          'Chores owed over these days stop counting — they are not marked done, '
          + 'not paid for, and not held against anyone. Use this for a sleepover, '
          + 'a sick day, or a week away.'),
        el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'Who'), who),
        el('div', { class: 'field-row' },
          el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'From'), from),
          el('div', { class: 'field' }, el('label', { class: 'field__label' }, 'To'), to),
        ),
        el('p', { class: 'field__hint' },
          'Anything already approved keeps its money. You can put a day back with Undo below.'),
        error,
      );

      return () => {
        if (!from.value || !to.value) { error.textContent = 'Pick both dates.'; return undefined; }
        if (to.value < from.value) { error.textContent = 'The end date is before the start date.'; return undefined; }
        return { childId: who.value, from: from.value, to: to.value };
      };
    },
  });
  if (!result) return;

  try {
    const res = await parentAction((token) =>
      db.excuseRange(token, result.childId, result.from, result.to));
    const n = res?.excused ?? 0;
    const name = childById(result.childId)?.name ?? 'They';
    toast(n
      ? `${n} chore${n === 1 ? '' : 's'} excused for ${name}`
      : `Nothing was outstanding for ${name} over those days`, 'good');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Excused spans in the week on screen, so they can be undone. */
function excusedSection() {
  const snap = state.snap;
  const excused = (snap.instances ?? []).filter((i) => i.status === 'excused');
  if (!excused.length) return null;

  // Group by child, then by the day the chore was owed.
  const byChild = new Map();
  for (const inst of excused) {
    if (!byChild.has(inst.child_id)) byChild.set(inst.child_id, []);
    byChild.get(inst.child_id).push(inst);
  }

  const rows = el('div', { class: 'rows' });
  for (const [childId, items] of byChild) {
    const child = childById(childId);
    const days = [...new Set(items.map((i) => i.due_date ?? addDays(snap.weekStart, 6)))].sort();
    const from = days[0];
    const to = days[days.length - 1];

    rows.append(
      el('div', { class: 'row' },
        el('span', { class: 'chore__emoji', style: { width: '38px', height: '38px', fontSize: '19px' } }, '🌴'),
        el('span', { class: 'row__body' },
          el('span', { class: 'row__title', style: { display: 'block' } }, child?.name ?? '—'),
          el('span', { class: 'row__meta', style: { display: 'block' } },
            `${items.length} chore${items.length === 1 ? '' : 's'} excused · `
            + (from === to ? formatLongDate(from) : `${formatLongDate(from)} – ${formatLongDate(to)}`)),
        ),
        el('button', {
          class: 'btn btn--ghost', type: 'button',
          onclick: async () => {
            try {
              const res = await parentAction((token) =>
                db.unexcuseRange(token, childId, from, to));
              toast(`${res?.restored ?? 0} chore(s) back on ${child?.name ?? 'their'} list`);
            } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Undo'),
      ),
    );
  }

  return section('Away this week', `${excused.length}`,
    el('p', { class: 'hint', style: { margin: '0 2px 10px' } },
      'These chores are not counted for or against anyone. Undo puts them back as not done.'),
    rows,
  );
}

// ---------------------------------------------------------------------
// Week grid
// ---------------------------------------------------------------------

/** One chore in a grid cell, marked with where it got to. */
function miniChore(item) {
  const MARK = { approved: '✓ ', submitted: '⏳ ', rejected: '↻ ', excused: '🌴 ' };
  const mark = MARK[item.status] ?? '';
  return el('span', {
    class: item.status === 'excused' ? 'mini mini--excused' : 'mini',
    title: item.status === 'excused' ? `${item.chore_name} — excused` : item.chore_name,
  }, `${mark}${item.chore_emoji} ${item.chore_name}`);
}

function weekGrid() {
  const snap = state.snap;
  const weekStartDay = settings().week_start_day ?? 0;
  const ws = snap.weekStart;
  const today = ymd();
  const kids = snap.children.filter((c) => c.active);

  const table = el('table', { class: 'grid-table' });
  const head = el('tr', {}, el('th', {}, ''));
  for (let i = 0; i < 7; i++) {
    const date = addDays(ws, i);
    head.append(el('th', {}, `${DAY_SHORT[dayOfWeek(date)]} ${Number(date.slice(8))}`));
  }
  head.append(el('th', {}, 'Anytime'));
  table.append(el('thead', {}, head));

  const tbody = el('tbody', {});
  for (const child of kids) {
    const row = el('tr', {}, el('td', { style: { fontWeight: '700', whiteSpace: 'nowrap' } },
      `${child.emoji} ${child.name}`));

    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      const items = snap.instances.filter((x) => x.child_id === child.id && x.due_date === date);
      const cell = el('td', { class: date === today ? 'is-today' : '' });
      if (!items.length) cell.append(el('span', { class: 'muted', style: { fontSize: '12px' } }, '—'));
      for (const item of items) {
        cell.append(miniChore(item));
      }
      row.append(cell);
    }

    const anytime = snap.instances.filter((x) => x.child_id === child.id && x.due_date === null);
    const cell = el('td', {});
    if (!anytime.length) cell.append(el('span', { class: 'muted', style: { fontSize: '12px' } }, '—'));
    for (const item of anytime) cell.append(miniChore(item));
    row.append(cell);

    tbody.append(row);
  }
  table.append(tbody);

  return el('div', { class: 'scroll-x' }, table);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

export function renderSchedule() {
  const snap = state.snap;
  const sym = currency();
  const wrap = el('div');
  const ws = snap.weekStart;
  const isThisWeek = ws === thisWeekStart();

  // ---- week navigation ----
  wrap.append(
    el('div', { class: 'week-nav' },
      el('button', { class: 'btn', type: 'button', onclick: () => goToWeek(addDays(ws, -7)), 'aria-label': 'Previous week' }, '‹'),
      el('div', { class: 'week-nav__label' },
        isThisWeek ? 'This week' : formatWeekRange(ws),
        isThisWeek ? el('span', { class: 'topbar__sub' }, formatWeekRange(ws)) : null,
      ),
      el('button', { class: 'btn', type: 'button', onclick: () => goToWeek(addDays(ws, 7)), 'aria-label': 'Next week' }, '›'),
    ),
  );

  if (!isThisWeek) {
    wrap.append(
      el('div', { class: 'banner' },
        el('span', {}, 'Viewing another week'),
        el('span', { class: 'banner__spacer' }),
        el('button', { class: 'btn', type: 'button', onclick: () => goToWeek(thisWeekStart()) }, 'Back to this week'),
      ),
    );
  }

  wrap.append(section('Planned', null,
    weekGrid(),
    el('button', {
      class: 'btn', type: 'button', style: { marginTop: '12px' },
      onclick: onMarkAway,
    }, '🌴 Mark someone away'),
  ));

  const away = excusedSection();
  if (away) wrap.append(away);

  // ---- chores ----
  const activeChores = snap.chores.filter((c) => c.active);
  const rows = el('div', { class: 'rows' });

  for (const chore of activeChores) {
    const assignments = snap.assignments.filter((a) => a.chore_id === chore.id && a.active);

    const describe = (a) => {
      const group = a.rotation_group_id
        ? snap.rotationGroups.find((g) => g.id === a.rotation_group_id)
        : null;
      const who = group ? rotationLabel(group) : (childById(a.child_id)?.name ?? '—');
      if (a.schedule_type === 'anytime') return `${who} · anytime`;
      if (a.schedule_type === 'oneoff') return `${who} · once`;
      const days = (a.days_of_week ?? []).slice().sort();
      const label = days.length === 7 ? 'every day'
        : days.length === 5 && days.every((d) => d >= 1 && d <= 5) ? 'weekdays'
        : days.map((d) => DAY_SHORT[d]).join(', ');
      return `${who} · ${label}`;
    };

    rows.append(
      el('button', {
        class: 'row',
        type: 'button',
        style: { textAlign: 'left', border: '0', width: '100%', cursor: 'pointer' },
        onclick: () => onEditChore(chore),
      },
        el('span', { class: 'chore__emoji', style: { width: '42px', height: '42px', fontSize: '21px' } }, chore.emoji),
        el('span', { class: 'row__body' },
          el('span', { class: 'row__title', style: { display: 'block' } },
            chore.name,
            chore.auto_approve ? el('span', { class: 'pill pill--muted', style: { marginLeft: '8px' } }, 'no check') : null,
          ),
          el('span', { class: 'row__meta', style: { display: 'block' } },
            assignments.length ? assignments.map(describe).join('  •  ') : 'Not assigned to anyone'),
        ),
        el('span', { class: 'chore__value' }, formatMoney(chore.value_cents, sym)),
      ),
    );
  }

  wrap.append(section('Chores', `${activeChores.length}`,
    activeChores.length ? rows : emptyState('📋', 'No chores yet', 'Add your first one below.'),
    el('button', { class: 'btn btn--primary', type: 'button', style: { marginTop: '12px' }, onclick: () => onEditChore(null) },
      '+ Add a chore'),
  ));

  // ---- rotations ----
  const groups = snap.rotationGroups ?? [];
  const groupRows = el('div', { class: 'rows' });
  for (const group of groups) {
    const names = (group.child_ids ?? []).map((id) => childById(id)?.name ?? '?').join(' → ');
    groupRows.append(
      el('button', {
        class: 'row', type: 'button',
        style: { textAlign: 'left', border: '0', width: '100%', cursor: 'pointer' },
        onclick: () => onEditGroup(group),
      },
        el('span', { class: 'chore__emoji', style: { width: '42px', height: '42px', fontSize: '20px' } }, '🔁'),
        el('span', { class: 'row__body' },
          el('span', { class: 'row__title', style: { display: 'block' } }, rotationLabel(group)),
          el('span', { class: 'row__meta', style: { display: 'block' } }, `${names} · swaps every week`),
        ),
      ),
    );
  }

  wrap.append(section('Rotations', null,
    groups.length ? groupRows : emptyState('🔁', 'No rotations', 'Use one to alternate a chore between the kids each week.'),
    el('button', { class: 'btn', type: 'button', style: { marginTop: '12px' }, onclick: () => onEditGroup(null) },
      '+ Add a rotation'),
  ));

  // ---- archived ----
  const archived = snap.chores.filter((c) => !c.active);
  if (archived.length) {
    const archivedRows = el('div', { class: 'rows' });
    for (const chore of archived) {
      archivedRows.append(
        el('div', { class: 'row row--inactive' },
          el('span', { class: 'chore__emoji', style: { width: '38px', height: '38px', fontSize: '19px' } }, chore.emoji),
          el('span', { class: 'row__body' }, el('span', { class: 'row__title' }, chore.name)),
          el('button', {
            class: 'btn btn--ghost', type: 'button',
            onclick: async () => {
              try {
                await parentAction((token) => db.upsertChore(token, { ...chore, active: true }));
                toast('Chore restored — add it back to the schedule', 'good');
              } catch (err) { toast(err.message, 'error'); }
            },
          }, 'Restore'),
        ),
      );
    }
    wrap.append(section('Archived', `${archived.length}`, archivedRows));
  }

  return wrap;
}
