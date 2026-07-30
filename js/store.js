// App state + a very small render loop.
//
// There is no framework here on purpose: this app should still be editable in
// five years with nothing installed. Views are plain functions that return DOM.

import { db } from './data.js';
import { ymd, weekStartFor, daysBetween } from './util.js';
import { EXPECTED_SCHEMA_VERSION } from './version.js';

const PROFILE_KEY = 'chore-tracker-profile';   // remembers whose tablet this is
const TOKEN_KEY = 'chore-tracker-parent';      // sessionStorage: gone when the browser closes

export const state = {
  statsRange: 'this_week',   // dashboard timeframe
  dataVersion: 0,            // bumped on every refresh; see refresh()
  schemaVersion: null,       // what the database actually has
  ready: false,
  route: 'picker',        // 'picker' | 'kid' | 'parent'
  parentTab: 'queue',     // 'queue' | 'ledger' | 'schedule' | 'settings'
  childId: null,
  parentToken: sessionStorage.getItem(TOKEN_KEY) || null,
  weekStart: null,        // which week the UI is showing
  snap: null,             // last snapshot from the adapter
  error: null,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

// ---------------------------------------------------------------------
// Boot & refresh
// ---------------------------------------------------------------------

export async function boot() {
  await db.init();
  // Idempotent, so it's safe on every load — this is what replaces a cron job.
  await db.generateWeek(ymd());
  await refresh();

  // Restore the profile this tablet was last used with.
  const saved = localStorage.getItem(PROFILE_KEY);
  if (saved === 'parent') {
    state.route = state.parentToken ? 'parent' : 'picker';
  } else if (saved && state.snap.children.some((c) => c.id === saved)) {
    state.route = 'kid';
    state.childId = saved;
  }

  // If the database is behind the app, say so plainly rather than letting it
  // surface later as a missing-function error from whichever screen hits it first.
  try { state.schemaVersion = await db.schemaVersion(); } catch { state.schemaVersion = null; }

  // Any change from another tab (demo mode) or another device (Supabase).
  db.subscribe(() => refresh());

  setState({ ready: true });
}

export async function refresh() {
  const snap = await db.snapshot({ weekStart: state.weekStart ?? undefined });
  state.snap = snap;
  state.weekStart = state.weekStart ?? snap.weekStart;
  // Bumped on every refresh. Views holding their own cache (the dashboard
  // fetches a wider date range than the snapshot) key off this to know their
  // figures are stale, without store.js needing to import them.
  state.dataVersion++;
  emit();
  return snap;
}

/** Jump to a different week (parent schedule view / kid history). */
export async function goToWeek(weekStart) {
  state.weekStart = weekStart;
  await refresh();
}

export function thisWeekStart() {
  return weekStartFor(ymd(), settings().week_start_day ?? 0);
}

// ---------------------------------------------------------------------
// Convenience selectors
// ---------------------------------------------------------------------

export function settings() {
  return state.snap?.household?.settings ?? {};
}

export function currency() {
  return settings().currency_symbol ?? '$';
}

export function childById(id) {
  return state.snap?.children.find((c) => c.id === id) ?? null;
}

export function currentChild() {
  return childById(state.childId);
}

export function balanceOf(childId) {
  return state.snap?.balances?.[childId] ?? 0;
}

/** Chores waiting for the parent, across every week. */
export function pendingQueue() {
  return state.snap?.pendingInstances ?? [];
}

export function instancesFor(childId) {
  return (state.snap?.instances ?? []).filter((i) => i.child_id === childId);
}

/**
 * Has this chore's window closed for good?
 *
 * Deliberately mirrors the late check inside submit_chore() in schema.sql. The
 * two must agree: if the UI offers a chore the database will refuse, the kid
 * taps it and gets an error, which is the behaviour this exists to prevent.
 *
 * Nothing ever expires while "Allow late chores" is on, which is the default.
 */
export function isExpired(inst) {
  if (!inst.due_date) return false;                                  // anytime / one-off
  if (!['pending', 'rejected'].includes(inst.status)) return false;  // already dealt with
  const s = settings();
  if (s.allow_late_submission !== false) return false;
  return daysBetween(inst.due_date, ymd()) > (s.late_grace_days ?? 0);
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

export function chooseChild(childId) {
  localStorage.setItem(PROFILE_KEY, childId);
  setState({ route: 'kid', childId, error: null });
}

export function goToPicker() {
  localStorage.removeItem(PROFILE_KEY);
  setState({ route: 'picker', childId: null, error: null });
}

export function enterParent(token) {
  state.parentToken = token;
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PROFILE_KEY, 'parent');
  setState({ route: 'parent', parentTab: 'queue', error: null });
}

export async function exitParent() {
  const token = state.parentToken;
  state.parentToken = null;
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  setState({ route: 'picker', error: null });
  if (token) {
    try { await db.parentLock(token); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------
// Every parent action funnels through here so an expired session is handled
// in exactly one place instead of at thirty call sites.

export async function parentAction(fn) {
  if (!state.parentToken) {
    setState({ route: 'picker' });
    throw new Error('Enter your PIN to continue.');
  }
  try {
    const result = await fn(state.parentToken);
    await refresh();
    return result;
  } catch (err) {
    if (err.code === 'session_expired') {
      state.parentToken = null;
      sessionStorage.removeItem(TOKEN_KEY);
      setState({ route: 'picker' });
    }
    throw err;
  }
}

export async function kidAction(fn) {
  const result = await fn();
  await refresh();
  return result;
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------

let toastTimer = null;

export function toast(message, kind = 'info') {
  const host = document.getElementById('toast');
  if (!host) return;
  host.textContent = message;
  host.className = `toast toast--${kind} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.className = 'toast'; }, kind === 'error' ? 5000 : 2800);
}

/** True when the database predates something this build of the app needs. */
export function schemaOutOfDate() {
  return state.schemaVersion !== null && state.schemaVersion < EXPECTED_SCHEMA_VERSION;
}

export { EXPECTED_SCHEMA_VERSION };
