-- Applied to a database that was created BEFORE 'excused' existed, with
-- schema.sql having just been run as a single transaction.
--
-- The failure this guards against is invisible on a fresh install: a new
-- database gets 'excused' from the original CREATE TYPE and never exercises
-- the ALTER path at all, so a `language sql` function mentioning the value
-- would pass every other test here and break only on a live project.

\set ON_ERROR_STOP on
\pset pager off

-- This database is built from schema.sql + seed.sql alone, so it never runs
-- tests.sql and does not inherit the assert() defined there.
create or replace function assert(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

do $$
declare
  v_tok   text;
  v_child uuid;
  v_ws    date;
  v_inst  uuid;
begin
  raise notice '--- upgrading a version-6 database ---';

  perform assert(schema_version() = 7, 'schema_version() reports 7 after the upgrade');

  perform assert(
    (select count(*) from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = 'chore_status' and e.enumlabel = 'excused') = 1,
    'the enum gained "excused" rather than being recreated');

  perform assert(
    (select count(*) from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = 'chore_status') = 5,
    'and kept its four original values');

  -- The goal columns arrive by ALTER on an upgrade too.
  perform assert(
    (select count(*) from information_schema.columns
      where table_name = 'children' and column_name in ('goal_cents', 'goal_label')) = 2,
    'children gained the savings-goal columns');

  -- Now actually USE the new value, which is the thing the transaction
  -- restriction would have blocked.
  delete from pin_attempts where id is not null;
  v_tok := parent_unlock('246810')->>'token';
  select id into v_child from children order by sort_order limit 1;
  v_ws := week_start_for(household_today());

  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_child, v_ws, v_ws + 1, 'pending', 100, 'upgrade check' from chores c limit 1
  returning id into v_inst;

  perform excuse_chore(v_tok, v_inst);
  perform assert(
    (select status from chore_instances where id = v_inst) = 'excused',
    'excuse_chore() works on the upgraded database');

  perform excuse_range(v_tok, v_child, v_ws, v_ws + 6);
  perform assert(
    (select count(*) from chore_instances
      where child_id = v_child and status = 'excused') > 0,
    'excuse_range() works too');

  raise notice 'UPGRADE TESTS PASSED';
end $$;
