// Supabase adapter: same interface as LocalAdapter, real cross-device sync.
//
// Every method here is either a plain SELECT (which RLS limits to reads) or
// an RPC. There is deliberately no direct INSERT/UPDATE/DELETE anywhere in
// this file — the database rejects those, and that is the whole point.

import { ymd, weekStartFor, addDays } from './util.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';

/**
 * The Supabase dashboard shows several URLs, and the one people reach for is
 * often an endpoint rather than the project root — the API settings page
 * displays `https://xxx.supabase.co/rest/v1/`, which is very reasonably
 * mistaken for "the URL".
 *
 * The client appends `/rest/v1/...` itself, so passing the endpoint produces
 * requests to `/rest/v1/rest/v1/...` and a baffling "Invalid path specified in
 * request URL". Trim the known endpoint suffixes and any trailing slash, and
 * say so in the console rather than silently papering over it.
 */
export function normalizeSupabaseUrl(raw) {
  const original = String(raw ?? '').trim();
  let url = original.replace(/\/+$/, '');

  for (const suffix of ['/rest/v1', '/auth/v1', '/storage/v1', '/graphql/v1', '/realtime/v1', '/functions/v1']) {
    if (url.toLowerCase().endsWith(suffix)) {
      url = url.slice(0, -suffix.length);
      break;
    }
  }
  url = url.replace(/\/+$/, '');

  return { url, changed: url !== original, original };
}

export class SupabaseAdapter {
  constructor(config) {
    this.mode = 'supabase';
    this.config = config;
    this.listeners = new Set();
    this.client = null;
  }

  async init() {
    const { createClient } = await import(SUPABASE_ESM);

    const { url, changed, original } = normalizeSupabaseUrl(this.config.supabaseUrl);
    if (changed) {
      console.warn(
        `[chore-tracker] Trimmed supabaseUrl to "${url}" (you had "${original}").\n` +
        'Edit config.js to match — it should be just https://YOUR-PROJECT.supabase.co',
      );
    }
    if (!/^https?:\/\/[^/]+$/.test(url)) {
      throw new Error(
        `supabaseUrl in config.js doesn't look right: "${original}". ` +
        'It should be just https://YOUR-PROJECT.supabase.co with nothing after it.',
      );
    }

    this.client = createClient(url, this.config.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    // Live updates: the parent's badge and the kid's "approved!" state.
    this.client
      .channel('chore-tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chore_instances' }, () => this.#emit())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries' }, () => this.#emit())
      .subscribe();

    return this;
  }

  #emit() {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Unwraps Supabase's {data, error} and turns errors into real throws. */
  async #rpc(name, args = {}) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) {
      const err = new Error(error.message || `${name} failed`);
      // require_parent() raises 28000; the UI uses this to re-prompt for the PIN.
      if (error.code === '28000' || /session expired/i.test(error.message ?? '')) {
        err.code = 'session_expired';
      }
      throw err;
    }
    return data;
  }

  async #select(table, build = (q) => q) {
    const { data, error } = await build(this.client.from(table).select('*'));
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // -------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------
  async snapshot({ weekStart } = {}) {
    const householdRows = await this.#select('household_public');
    const household = householdRows[0] ?? { name: 'Our Household', settings: {}, pin_is_set: false };
    const ws = weekStart ?? weekStartFor(ymd(), household.settings?.week_start_day ?? 0);

    const [children, chores, rotationGroups, assignments, instances, pendingInstances, balanceRows, recentLedger] =
      await Promise.all([
        this.#select('children', (q) => q.order('sort_order')),
        this.#select('chores', (q) => q.order('name')),
        this.#select('rotation_groups'),
        this.#select('assignments'),
        this.#select('chore_instances', (q) => q.eq('week_start', ws)),
        this.#select('chore_instances', (q) => q.eq('status', 'submitted').order('submitted_at')),
        this.#rpc('child_balances'),
        this.#select('ledger_entries', (q) => q.order('created_at', { ascending: false }).limit(100)),
      ]);

    const balances = {};
    for (const c of children) balances[c.id] = 0;
    for (const row of balanceRows ?? []) balances[row.child_id] = Number(row.balance_cents);

    return {
      household, children, chores, rotationGroups, assignments,
      instances, pendingInstances, balances, recentLedger, weekStart: ws,
    };
  }

  /**
   * What version of schema.sql the database actually has.
   *
   * Returns 1 if the function itself is missing, which is exactly what a
   * database predating this check looks like.
   */
  async schemaVersion() {
    try {
      return Number(await this.#rpc('schema_version')) || 1;
    } catch {
      return 1;
    }
  }

  async generateWeek(anyDate = ymd()) {
    return this.#rpc('generate_week', { p_any_date: anyDate });
  }

  /**
   * Chore instances for a date range, plus lifetime money totals.
   *
   * Returns raw rows on purpose — js/stats.js summarises for both adapters, so
   * the dashboard can't produce different numbers in demo mode and live mode.
   */
  async statsFor({ from = null, to = null } = {}) {
    // A week's anytime chores count on the last day of that week, so widen the
    // lower bound by six days and let stats.js filter precisely.
    const lower = from ? addDays(from, -6) : null;

    const [instances, lifetimeRows] = await Promise.all([
      this.#select('chore_instances', (q) => {
        let query = q;
        if (lower) query = query.gte('week_start', lower);
        if (to) query = query.lte('week_start', to);
        return query;
      }),
      // Missing on a database that hasn't had the latest schema.sql applied.
      // The rest of the dashboard is still worth showing, and the version
      // banner explains what to do about it.
      this.#rpc('lifetime_totals').catch(() => []),
    ]);

    const lifetime = {};
    for (const row of lifetimeRows ?? []) {
      lifetime[row.child_id] = {
        earned: Number(row.earned_cents),
        paid: Number(row.paid_cents),
        adjusted: Number(row.adjusted_cents),
        balance: Number(row.balance_cents),
      };
    }

    return { instances, lifetime, from, to };
  }

  // -------------------------------------------------------------------
  // parent session
  // -------------------------------------------------------------------
  parentStatus()               { return this.#rpc('parent_status'); }
  parentUnlock(pin)            { return this.#rpc('parent_unlock', { p_pin: String(pin) }); }
  parentLock(token)            { return this.#rpc('parent_lock', { p_token: token }); }
  setParentPin(token, newPin)  { return this.#rpc('set_parent_pin', { p_token: token, p_new_pin: String(newPin) }); }

  // -------------------------------------------------------------------
  // kid actions
  // -------------------------------------------------------------------
  submitChore(id)   { return this.#rpc('submit_chore',   { p_instance_id: id }); }
  unsubmitChore(id) { return this.#rpc('unsubmit_chore', { p_instance_id: id }); }

  // -------------------------------------------------------------------
  // parent actions
  // -------------------------------------------------------------------
  approveChore(token, id) {
    return this.#rpc('approve_chore', { p_token: token, p_instance_id: id });
  }
  rejectChore(token, id, note) {
    return this.#rpc('reject_chore', { p_token: token, p_instance_id: id, p_note: note ?? null });
  }
  approveAll(token, childId = null) {
    return this.#rpc('approve_all', { p_token: token, p_child_id: childId });
  }
  recordPayout(token, childId, cents, note = '') {
    return this.#rpc('record_payout', { p_token: token, p_child_id: childId, p_amount_cents: cents, p_note: note });
  }
  adjustBalance(token, childId, cents, note = '') {
    return this.#rpc('adjust_balance', { p_token: token, p_child_id: childId, p_amount_cents: cents, p_note: note });
  }

  // -------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------
  upsertChild(token, child)       { return this.#rpc('upsert_child',  { p_token: token, p_child: child }); }
  upsertChore(token, chore)       { return this.#rpc('upsert_chore',  { p_token: token, p_chore: chore }); }
  upsertAssignment(token, a)      { return this.#rpc('upsert_assignment', { p_token: token, p_assignment: a }); }
  deleteAssignment(token, id)     { return this.#rpc('delete_assignment', { p_token: token, p_assignment_id: id }); }
  upsertRotationGroup(token, g)   { return this.#rpc('upsert_rotation_group', { p_token: token, p_group: g }); }
  updateSettings(token, patch)    { return this.#rpc('update_settings', { p_token: token, p_patch: patch }); }
  renameHousehold(token, name)    { return this.#rpc('rename_household', { p_token: token, p_name: name }); }
  startFresh(token, from, wipeMoney = false) {
    return this.#rpc('start_fresh', { p_token: token, p_from: from, p_wipe_money: wipeMoney });
  }

  // -------------------------------------------------------------------
  // push
  // -------------------------------------------------------------------
  registerPush(token, sub, label = '') {
    const json = sub.toJSON();
    return this.#rpc('register_push', {
      p_token: token,
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_label: label,
    });
  }
  unregisterPush(endpoint) {
    return this.#rpc('unregister_push', { p_endpoint: endpoint });
  }

  async resetDemo() {
    throw new Error('Reset is only available in demo mode.');
  }
}
