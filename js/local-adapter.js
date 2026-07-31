// Demo/offline adapter: the whole app running out of localStorage.
//
// This deliberately mirrors supabase/schema.sql semantics — value snapshots,
// one-earning-per-chore, PIN lockout, rotation, auto-approve, late-submission
// rules. If the two ever disagree, the SQL is the source of truth.
//
// It exists so you can open index.html and use the real app before creating
// any account. Data lives in one browser and does not sync.

import { uuid, ymd, addDays, weekStartFor, dayOfWeek, daysBetween } from './util.js';
import { EXPECTED_SCHEMA_VERSION } from './version.js';

const KEY = 'chore-tracker-db-v1';

const DEFAULT_SETTINGS = {
  week_start_day: 0,
  currency_symbol: '$',
  allow_late_submission: true,
  late_grace_days: 3,
  notify_push: true,
  notify_email: true,
  notify_email_to: '',
  quiet_hours_start: 21,
  quiet_hours_end: 7,
  timezone: 'UTC',
  history_start_date: null,
  parent_session_minutes: 240,
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyDb() {
  return {
    household: { id: uuid(), name: 'Our Household', parent_pin_hash: null, settings: { ...DEFAULT_SETTINGS } },
    children: [],
    chores: [],
    rotation_groups: [],
    assignments: [],
    chore_instances: [],
    ledger_entries: [],
    pin_attempts: [],
    parent_sessions: [],
  };
}

export class LocalAdapter {
  constructor() {
    this.mode = 'local';
    this.listeners = new Set();
    this.channel = 'BroadcastChannel' in self ? new BroadcastChannel('chore-tracker') : null;
    if (this.channel) {
      this.channel.onmessage = () => this.#emit(false);
    }
    // Another tab wrote to localStorage.
    addEventListener('storage', (e) => {
      if (e.key === KEY) this.#emit(false);
    });
  }

  async init() {
    if (!localStorage.getItem(KEY)) {
      this.#write(seedDemoData());
    }
    return this;
  }

  // -------------------------------------------------------------------
  // storage
  // -------------------------------------------------------------------
  #read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : emptyDb();
    } catch {
      return emptyDb();
    }
  }

  #write(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
    return db;
  }

  #commit(db) {
    this.#write(db);
    this.#emit(true);
    return db;
  }

  #emit(broadcast) {
    if (broadcast && this.channel) this.channel.postMessage('changed');
    for (const fn of this.listeners) fn();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Wipe everything and reseed. Used by Settings → "Reset demo data". */
  async resetDemo() {
    this.#commit(seedDemoData());
  }

  // -------------------------------------------------------------------
  // parent session
  // -------------------------------------------------------------------
  #recentFailures(db) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    return db.pin_attempts.filter((a) => !a.succeeded && a.at > cutoff).length;
  }

  async parentStatus() {
    const db = this.#read();
    const fails = this.#recentFailures(db);
    return { pin_is_set: !!db.household.parent_pin_hash, recent_failures: fails, locked: fails >= 5 };
  }

  async parentUnlock(pin) {
    const db = this.#read();
    const fails = this.#recentFailures(db);
    if (fails >= 5) return { ok: false, reason: 'locked' };

    const mint = () => {
      const token = uuid();
      const minutes = db.household.settings.parent_session_minutes ?? 240;
      db.parent_sessions = db.parent_sessions.filter((s) => s.expires_at > Date.now());
      db.parent_sessions.push({ token, expires_at: Date.now() + minutes * 60000 });
      return token;
    };

    if (!db.household.parent_pin_hash) {
      const token = mint();
      this.#commit(db);
      return { ok: true, token, needs_pin_setup: true };
    }

    if ((await sha256(pin)) === db.household.parent_pin_hash) {
      db.pin_attempts.push({ succeeded: true, at: Date.now() });
      const token = mint();
      this.#commit(db);
      return { ok: true, token };
    }

    db.pin_attempts.push({ succeeded: false, at: Date.now() });
    this.#commit(db);
    return { ok: false, reason: 'bad_pin', attempts_left: Math.max(0, 4 - fails) };
  }

  async parentLock(token) {
    const db = this.#read();
    db.parent_sessions = db.parent_sessions.filter((s) => s.token !== token);
    this.#commit(db);
  }

  /** Throws unless the token is live. Sliding expiry, same as require_parent(). */
  #requireParent(db, token) {
    const now = Date.now();
    db.parent_sessions = db.parent_sessions.filter((s) => s.expires_at > now);
    const session = db.parent_sessions.find((s) => s.token === token);
    if (!session) {
      const err = new Error('Parent session expired. Enter your PIN again.');
      err.code = 'session_expired';
      throw err;
    }
    session.expires_at = now + (db.household.settings.parent_session_minutes ?? 240) * 60000;
  }

  async setParentPin(token, newPin) {
    const db = this.#read();
    this.#requireParent(db, token);
    if (!newPin || String(newPin).trim().length < 4) throw new Error('PIN must be at least 4 digits.');
    db.household.parent_pin_hash = await sha256(String(newPin));
    db.pin_attempts = [];
    this.#commit(db);
  }

  // -------------------------------------------------------------------
  // week generation — mirrors generate_week()
  // -------------------------------------------------------------------
  #generate(db, anyDate) {
    const settings = db.household.settings;
    const ws = weekStartFor(anyDate, settings.week_start_day ?? 0);
    const wsDow = dayOfWeek(ws);
    const weekEnd = addDays(ws, 6);

    const isLive = (a) => {
      const chore = db.chores.find((c) => c.id === a.chore_id);
      return (
        a.active &&
        chore?.active &&
        a.effective_from <= weekEnd &&
        (!a.effective_to || a.effective_to >= ws)
      );
    };

    const has = (assignmentId, childId, dueDate) =>
      db.chore_instances.some(
        (ci) =>
          ci.assignment_id === assignmentId &&
          ci.child_id === childId &&
          ci.week_start === ws &&
          (ci.due_date ?? null) === (dueDate ?? null),
      );

    const hist = settings.history_start_date || null;

    // Every (assignment, child, day) the template currently calls for, so the
    // sweep below can spot instances that no longer belong. Same idea as
    // want_key() in schema.sql.
    const want = new Set();
    const key = (assignmentId, childId, dueDate) =>
      `${assignmentId}|${childId}|${dueDate ?? '-'}`;

    const add = (a, chore, childId, dueDate) => {
      // Matches generate_week(): never regenerate what start_fresh() cleared.
      if (hist && (dueDate ?? weekEnd) < hist) return;
      want.add(key(a.id, childId, dueDate));
      if (has(a.id, childId, dueDate)) return;
      db.chore_instances.push({
        id: uuid(),
        assignment_id: a.id,
        chore_id: a.chore_id,
        child_id: childId,
        week_start: ws,
        due_date: dueDate ?? null,
        status: 'pending',
        // Snapshotted, exactly like the SQL.
        value_cents: a.value_cents_override ?? chore.value_cents,
        chore_name: chore.name,
        chore_emoji: chore.emoji,
        submitted_at: null,
        reviewed_at: null,
        review_note: null,
      });
    };

    for (const a of db.assignments) {
      if (!isLive(a)) continue;
      const chore = db.chores.find((c) => c.id === a.chore_id);

      let childId = a.child_id;
      if (!childId && a.rotation_group_id) {
        const g = db.rotation_groups.find((x) => x.id === a.rotation_group_id);
        if (!g?.child_ids?.length) continue;
        const weeks = Math.floor(daysBetween(g.anchor_week, ws) / 7);
        const n = g.child_ids.length;
        childId = g.child_ids[(((weeks % n) + n) % n)];
      }
      if (!childId) continue;

      if (a.schedule_type === 'weekly_days') {
        for (const dow of a.days_of_week ?? []) {
          add(a, chore, childId, addDays(ws, ((dow - wsDow) + 7) % 7));
        }
      } else if (a.schedule_type === 'anytime') {
        add(a, chore, childId, null);
      } else if (a.schedule_type === 'oneoff') {
        if (weekStartFor(a.oneoff_week, settings.week_start_day ?? 0) === ws) add(a, chore, childId, null);
      }
    }

    // Sweep untouched chores the template no longer calls for. Checking only
    // whether the assignment still exists missed the common case: reassign a
    // chore to the other child and the assignment is still active while the
    // instances it produced are now wrong, so it showed on both kids at once.
    db.chore_instances = db.chore_instances.filter((ci) => {
      if (ci.week_start !== ws || ci.status !== 'pending' || !ci.assignment_id) return true;
      return want.has(key(ci.assignment_id, ci.child_id, ci.due_date));
    });

    return ws;
  }

  /** Demo mode ships with the app, so it is never behind. */
  async schemaVersion() {
    return EXPECTED_SCHEMA_VERSION;
  }

  async generateWeek(anyDate = ymd()) {
    const db = this.#read();
    const ws = this.#generate(db, anyDate);
    this.#commit(db);
    return { week_start: ws };
  }

  // -------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------
  async snapshot({ weekStart } = {}) {
    const db = this.#read();
    const settings = db.household.settings;
    const ws = weekStart ?? weekStartFor(ymd(), settings.week_start_day ?? 0);

    const balances = {};
    for (const c of db.children) balances[c.id] = 0;
    for (const l of db.ledger_entries) balances[l.child_id] = (balances[l.child_id] ?? 0) + l.amount_cents;

    return {
      household: {
        id: db.household.id,
        name: db.household.name,
        settings,
        pin_is_set: !!db.household.parent_pin_hash,
      },
      children: [...db.children].sort((a, b) => a.sort_order - b.sort_order),
      chores: [...db.chores].sort((a, b) => a.name.localeCompare(b.name)),
      rotationGroups: db.rotation_groups,
      assignments: db.assignments,
      instances: db.chore_instances.filter((ci) => ci.week_start === ws),
      // Submitted work from ANY week, so nothing can get stranded.
      pendingInstances: db.chore_instances
        .filter((ci) => ci.status === 'submitted')
        .sort((a, b) => (a.submitted_at ?? 0) - (b.submitted_at ?? 0)),
      balances,
      recentLedger: [...db.ledger_entries].sort((a, b) => b.created_at - a.created_at).slice(0, 100),
      weekStart: ws,
    };
  }

  /**
   * Chore instances for a date range, plus lifetime money totals.
   *
   * Deliberately returns raw rows rather than computed figures: js/stats.js
   * does the summarising for both adapters, so the dashboard can't disagree
   * with itself depending on which mode you're in.
   */
  async statsFor({ from = null, to = null } = {}) {
    const db = this.#read();

    // A week's anytime chores count on the last day of that week, so widen the
    // lower bound by six days before filtering precisely in stats.js.
    const lower = from ? addDays(from, -6) : null;
    const instances = db.chore_instances.filter((ci) => {
      if (lower && ci.week_start < lower) return false;
      if (to && ci.week_start > to) return false;
      return true;
    });

    const lifetime = {};
    for (const c of db.children) {
      lifetime[c.id] = { earned: 0, paid: 0, adjusted: 0, balance: 0 };
    }
    for (const l of db.ledger_entries) {
      const t = lifetime[l.child_id];
      if (!t) continue;
      if (l.type === 'earning') t.earned += l.amount_cents;
      else if (l.type === 'payout') t.paid += -l.amount_cents;
      else t.adjusted += l.amount_cents;
      t.balance += l.amount_cents;
    }

    return { instances, lifetime, from, to };
  }

  // -------------------------------------------------------------------
  // kid actions
  // -------------------------------------------------------------------
  #earn(db, inst) {
    // The SQL guarantees this with a partial unique index; here we check.
    const already = db.ledger_entries.some((l) => l.chore_instance_id === inst.id && l.type === 'earning');
    if (already) return;
    db.ledger_entries.push({
      id: uuid(),
      child_id: inst.child_id,
      type: 'earning',
      amount_cents: inst.value_cents,
      chore_instance_id: inst.id,
      note: inst.chore_name,
      created_at: Date.now(),
    });
  }

  async submitChore(id) {
    const db = this.#read();
    const inst = db.chore_instances.find((c) => c.id === id);
    if (!inst) throw new Error('That chore no longer exists.');
    if (!['pending', 'rejected'].includes(inst.status)) return { ok: true, status: inst.status, noop: true };

    const settings = db.household.settings;
    if (inst.due_date && settings.allow_late_submission === false) {
      const grace = settings.late_grace_days ?? 0;
      // ymd() is already the device's local date, which is the household's —
      // the equivalent of household_today() in schema.sql, where the server
      // would otherwise be judging this in UTC.
      if (daysBetween(inst.due_date, ymd()) > grace) throw new Error('This chore is past its due date.');
    }

    const chore = db.chores.find((c) => c.id === inst.chore_id);
    inst.submitted_at = Date.now();

    if (chore?.auto_approve) {
      inst.status = 'approved';
      inst.reviewed_at = Date.now();
      inst.review_note = null;
      this.#earn(db, inst);
      this.#commit(db);
      return { ok: true, status: 'approved', auto: true };
    }

    inst.status = 'submitted';
    inst.reviewed_at = null;
    inst.review_note = null;
    this.#commit(db);
    return { ok: true, status: 'submitted' };
  }

  async unsubmitChore(id) {
    const db = this.#read();
    const inst = db.chore_instances.find((c) => c.id === id);
    if (!inst || inst.status !== 'submitted') throw new Error('Too late to undo that one.');
    inst.status = 'pending';
    inst.submitted_at = null;
    this.#commit(db);
    return { ok: true, status: 'pending' };
  }

  // -------------------------------------------------------------------
  // parent actions
  // -------------------------------------------------------------------
  #approve(db, id) {
    const inst = db.chore_instances.find((c) => c.id === id);
    if (!inst || !['submitted', 'pending', 'rejected'].includes(inst.status)) return 0;
    inst.status = 'approved';
    inst.reviewed_at = Date.now();
    inst.review_note = null;
    const before = db.ledger_entries.length;
    this.#earn(db, inst);
    return db.ledger_entries.length > before ? inst.value_cents : 0;
  }

  async approveChore(token, id) {
    const db = this.#read();
    this.#requireParent(db, token);
    const amount = this.#approve(db, id);
    this.#commit(db);
    return { ok: true, status: 'approved', amount_cents: amount };
  }

  async approveAll(token, childId = null) {
    const db = this.#read();
    this.#requireParent(db, token);
    let count = 0;
    let sum = 0;
    for (const inst of db.chore_instances) {
      if (inst.status !== 'submitted') continue;
      if (childId && inst.child_id !== childId) continue;
      sum += this.#approve(db, inst.id);
      count++;
    }
    this.#commit(db);
    return { ok: true, approved: count, amount_cents: sum };
  }

  /** Mirrors unapprove_chore(): back to not-done, money taken back, no note. */
  async unapproveChore(token, id) {
    const db = this.#read();
    this.#requireParent(db, token);
    const inst = db.chore_instances.find((c) => c.id === id);
    if (!inst || !['approved', 'submitted'].includes(inst.status)) return { ok: true, noop: true };

    inst.status = 'pending';
    inst.submitted_at = null;
    inst.reviewed_at = null;
    inst.review_note = null;
    db.ledger_entries = db.ledger_entries.filter(
      (l) => !(l.chore_instance_id === id && l.type === 'earning'),
    );
    this.#commit(db);
    return { ok: true, status: 'pending', amount_cents: inst.value_cents };
  }

  async rejectChore(token, id, note) {
    const db = this.#read();
    this.#requireParent(db, token);
    const inst = db.chore_instances.find((c) => c.id === id);
    if (!inst || !['submitted', 'approved'].includes(inst.status)) return { ok: true, noop: true };
    inst.status = 'rejected';
    inst.reviewed_at = Date.now();
    inst.review_note = (note ?? '').trim() || null;
    // Claw back if it had been approved.
    db.ledger_entries = db.ledger_entries.filter(
      (l) => !(l.chore_instance_id === id && l.type === 'earning'),
    );
    this.#commit(db);
    return { ok: true, status: 'rejected' };
  }

  async recordPayout(token, childId, cents, note = '') {
    const db = this.#read();
    this.#requireParent(db, token);
    if (!cents || cents <= 0) throw new Error('Payout amount must be greater than zero.');
    db.ledger_entries.push({
      id: uuid(), child_id: childId, type: 'payout',
      amount_cents: -cents, chore_instance_id: null, note, created_at: Date.now(),
    });
    this.#commit(db);
    return { ok: true };
  }

  async adjustBalance(token, childId, cents, note = '') {
    const db = this.#read();
    this.#requireParent(db, token);
    if (!cents) throw new Error('Adjustment cannot be zero.');
    db.ledger_entries.push({
      id: uuid(), child_id: childId, type: 'adjustment',
      amount_cents: cents, chore_instance_id: null, note, created_at: Date.now(),
    });
    this.#commit(db);
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------
  async upsertChild(token, child) {
    const db = this.#read();
    this.#requireParent(db, token);
    const existing = db.children.find((c) => c.id === child.id);
    if (existing) Object.assign(existing, child);
    else db.children.push({
      id: uuid(), name: child.name, color: child.color ?? '#6366f1',
      emoji: child.emoji ?? '⭐', sort_order: child.sort_order ?? db.children.length + 1,
      active: child.active ?? true,
    });
    this.#commit(db);
  }

  async upsertChore(token, chore) {
    const db = this.#read();
    this.#requireParent(db, token);
    const existing = db.chores.find((c) => c.id === chore.id);
    if (existing) {
      Object.assign(existing, chore);
      // Re-price only work that hasn't been acted on, this week or later.
      const ws = weekStartFor(ymd(), db.household.settings.week_start_day ?? 0);
      for (const ci of db.chore_instances) {
        if (ci.chore_id !== existing.id) continue;
        if (!['pending', 'rejected'].includes(ci.status)) continue;
        if (ci.week_start < ws) continue;
        const a = db.assignments.find((x) => x.id === ci.assignment_id);
        if (a?.value_cents_override != null) continue;
        ci.value_cents = existing.value_cents;
        ci.chore_name = existing.name;
        ci.chore_emoji = existing.emoji;
      }
    } else {
      db.chores.push({
        id: uuid(), name: chore.name, emoji: chore.emoji ?? '✅',
        description: chore.description ?? '', value_cents: chore.value_cents ?? 50,
        auto_approve: chore.auto_approve ?? false, active: chore.active ?? true,
      });
    }
    this.#commit(db);
  }

  async upsertAssignment(token, a) {
    const db = this.#read();
    this.#requireParent(db, token);
    const existing = db.assignments.find((x) => x.id === a.id);
    if (existing) Object.assign(existing, a);
    else db.assignments.push({
      id: uuid(),
      chore_id: a.chore_id,
      child_id: a.child_id ?? null,
      rotation_group_id: a.rotation_group_id ?? null,
      schedule_type: a.schedule_type ?? 'weekly_days',
      days_of_week: a.days_of_week ?? [],
      oneoff_week: a.oneoff_week ?? null,
      value_cents_override: a.value_cents_override ?? null,
      active: a.active ?? true,
      effective_from: a.effective_from ?? ymd(),
      effective_to: a.effective_to ?? null,
    });
    this.#generate(db, ymd());
    this.#commit(db);
  }

  async deleteAssignment(token, id) {
    const db = this.#read();
    this.#requireParent(db, token);
    const a = db.assignments.find((x) => x.id === id);
    if (a) a.active = false;
    this.#generate(db, ymd());
    this.#commit(db);
  }

  async upsertRotationGroup(token, group) {
    const db = this.#read();
    this.#requireParent(db, token);
    const existing = db.rotation_groups.find((g) => g.id === group.id);
    if (existing) Object.assign(existing, group);
    else db.rotation_groups.push({
      id: uuid(), name: group.name, child_ids: group.child_ids ?? [],
      anchor_week: group.anchor_week ?? weekStartFor(ymd(), db.household.settings.week_start_day ?? 0),
    });
    this.#commit(db);
  }

  async updateSettings(token, patch) {
    const db = this.#read();
    this.#requireParent(db, token);
    Object.assign(db.household.settings, patch);
    this.#commit(db);
    return db.household.settings;
  }

  /** Mirrors start_fresh() in schema.sql. */
  async startFresh(token, from, wipeMoney = false) {
    const db = this.#read();
    this.#requireParent(db, token);
    if (!from) throw new Error('A start date is required.');

    const effective = (ci) => ci.due_date ?? addDays(ci.week_start, 6);
    const before = db.chore_instances.length;

    if (wipeMoney) {
      db.ledger_entries = [];
      db.chore_instances = db.chore_instances.filter((ci) => effective(ci) >= from);
    } else {
      // Approved work and the money it earned survive; only untouched chores go.
      db.chore_instances = db.chore_instances.filter(
        (ci) => effective(ci) >= from || !['pending', 'rejected'].includes(ci.status),
      );
    }

    db.household.settings.history_start_date = from;
    this.#commit(db);
    return { ok: true, from, chores_removed: before - db.chore_instances.length };
  }

  async renameHousehold(token, name) {
    const db = this.#read();
    this.#requireParent(db, token);
    db.household.name = name;
    this.#commit(db);
  }

  // Push isn't available without a server; the UI hides it in local mode.
  async registerPush() { throw new Error('Phone notifications need the Supabase backend.'); }
  async unregisterPush() {}
}

// ---------------------------------------------------------------------
// Demo data — mirrors supabase/seed.sql so both modes look the same.
// ---------------------------------------------------------------------
function seedDemoData() {
  const db = emptyDb();
  const today = ymd();
  const ws = weekStartFor(today, 0);

  const ava = { id: uuid(), name: 'Ava', color: '#e11d48', emoji: '🦊', sort_order: 1, active: true };
  const mia = { id: uuid(), name: 'Mia', color: '#7c3aed', emoji: '🐨', sort_order: 2, active: true };
  db.children.push(ava, mia);

  const rot = { id: uuid(), name: 'Ava & Mia', child_ids: [ava.id, mia.id], anchor_week: ws };
  db.rotation_groups.push(rot);

  const chore = (name, emoji, description, value_cents, auto_approve = false) => {
    const c = { id: uuid(), name, emoji, description, value_cents, auto_approve, active: true };
    db.chores.push(c);
    return c;
  };
  const assign = (c, opts) => {
    db.assignments.push({
      id: uuid(), chore_id: c.id,
      child_id: opts.child ?? null,
      rotation_group_id: opts.rotation ?? null,
      schedule_type: opts.type ?? 'weekly_days',
      days_of_week: opts.days ?? [],
      oneoff_week: opts.week ?? null,
      value_cents_override: null,
      active: true, effective_from: addDays(today, -30), effective_to: null,
    });
  };

  const bed = chore('Make your bed', '🛏️', 'Covers straight, pillows on top.', 25);
  assign(bed, { child: ava.id, days: [0, 1, 2, 3, 4, 5, 6] });
  assign(bed, { child: mia.id, days: [0, 1, 2, 3, 4, 5, 6] });

  const read = chore('Read for 20 minutes', '📚', 'Any book you like.', 25, true);
  assign(read, { child: ava.id, days: [1, 2, 3, 4, 5] });
  assign(read, { child: mia.id, days: [1, 2, 3, 4, 5] });

  const table = chore('Set the table', '🍽️', 'Plates, cups and forks for everyone.', 40);
  assign(table, { child: mia.id, days: [1, 2, 3, 4, 5] });

  const dishes = chore('Load the dishwasher', '🧼', 'Rinse first, then stack it properly.', 75);
  assign(dishes, { child: ava.id, days: [1, 2, 3, 4, 5] });

  const dog = chore('Feed the dog', '🐕', 'One scoop, and fresh water.', 50);
  assign(dog, { rotation: rot.id, days: [0, 1, 2, 3, 4, 5, 6] });

  const trash = chore('Take out the trash', '🗑️', 'Bins to the curb, new bag in.', 100);
  assign(trash, { rotation: rot.id, days: [2] });

  const vacuum = chore('Vacuum the living room', '🧹', 'Under the couch cushions too.', 150);
  assign(vacuum, { rotation: rot.id, days: [6] });

  const room = chore('Tidy your bedroom', '🧸', 'Floor clear, clothes away.', 100);
  assign(room, { child: ava.id, type: 'anytime' });
  assign(room, { child: mia.id, type: 'anytime' });

  const laundry = chore('Put your laundry away', '🧺', 'Folded, in the right drawers.', 75);
  assign(laundry, { child: ava.id, type: 'anytime' });
  assign(laundry, { child: mia.id, type: 'anytime' });

  const garage = chore('Help clean out the garage', '📦', 'Bonus job — big help!', 300);
  assign(garage, { child: ava.id, type: 'oneoff', week: ws });

  return db;
}
