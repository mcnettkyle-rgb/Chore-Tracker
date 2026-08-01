// The version of supabase/schema.sql this build of the app needs.
//
// Its own module so both adapters and the store can read it without importing
// each other in a circle.
//
// Bump this and schema_version() in schema.sql together whenever the app
// starts depending on something new in the database. The app compares the two
// and tells the parent to re-run schema.sql if their database is behind —
// otherwise a missed SQL step shows up as a raw PostgREST error about a
// missing function, which explains nothing.
//
//   1  initial schema
//   2  lifetime_totals() for the parent dashboard
//   3  start_fresh() and the history_start_date setting
//   4  household_today(): dates judged in the family's timezone, not UTC
//   5  unapprove_chore() for undoing an accidental approval
//   6  history_start_date clamped to today, so it can never hide today's chores
//   7  'excused' chores (sleepovers, sick days) and savings goals per child
//   8  bonus chores: extra money, and outside the stats entirely
//   9  open-ended bonus jobs, which sit there until done rather than expiring
export const EXPECTED_SCHEMA_VERSION = 9;

/**
 * Which build of the app this is. Shown at the bottom of Settings.
 *
 * There is no build step to stamp this automatically, so it is bumped by hand
 * with anything worth deploying. It exists because "is my update live yet?"
 * was otherwise only answerable by hunting for a feature and hoping — and a
 * browser serving a cached copy looks identical to a deploy that never
 * happened. A version you can read settles it in two seconds.
 *
 *   1.0.0  first release
 *   1.1.0  the parent's week navigation stops leaking onto the kids' screens
 *   1.2.0  days off, savings goals, streaks, backups
 *   1.2.1  service worker revalidates, so a deploy shows up immediately
 *   1.3.0  streaks on the picker; bonus chores
 *   1.4.0  bonus jobs can have no deadline at all
 *   1.4.1  a streak shows from day one, not from day two
 */
export const APP_VERSION = '1.4.1';
