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
export const EXPECTED_SCHEMA_VERSION = 4;
