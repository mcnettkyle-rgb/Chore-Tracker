-- Excusing chores: "this didn't happen, and that's fine".
--
-- The point of the feature is the completion rate. A child away for three days
-- must not have those days counted against them, or the number the whole
-- reward mechanic rests on stops meaning anything.
--
-- So the assertions here are less about the status column and more about what
-- survives: excused work must outlive generate_week() (which runs on every
-- page load and deletes chores the template no longer calls for) and
-- start_fresh(), exactly as approved work does.

\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_tok     text;
  v_child   uuid;
  v_other   uuid;
  v_ws      date;
  v_inst    uuid;
  v_appr    uuid;
  v_n       int;
  v_res     jsonb;
begin
  raise notice '--- excusing chores ---';

  delete from pin_attempts where id is not null;
  v_tok := parent_unlock('246810')->>'token';
  perform assert(v_tok is not null, 'got a parent session');

  select id into v_child from children order by sort_order limit 1;
  select id into v_other from children where id <> v_child order by sort_order limit 1;
  v_ws := week_start_for(household_today());

  -- ---- one chore ----
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_child, v_ws, v_ws + 1, 'pending', 100, 'away chore' from chores c limit 1
  returning id into v_inst;

  perform excuse_chore(v_tok, v_inst);
  perform assert(
    (select status from chore_instances where id = v_inst) = 'excused',
    'a pending chore can be excused');

  perform assert(
    (select review_note is null from chore_instances where id = v_inst),
    'excusing leaves no note -- it is not a telling-off');

  -- No money moves either way.
  perform assert(
    (select count(*) from ledger_entries where chore_instance_id = v_inst) = 0,
    'excusing pays nothing');

  -- ---- it must not be silently undone by the next page load ----
  perform generate_week(household_today());
  perform assert(
    (select status from chore_instances where id = v_inst) = 'excused',
    'generate_week() leaves an excused chore alone');

  -- ---- and it can be put back ----
  perform unexcuse_chore(v_tok, v_inst);
  perform assert(
    (select status from chore_instances where id = v_inst) = 'pending',
    'unexcuse_chore() puts it back on the list');

  -- ---- earned work is NOT excusable ----
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_child, v_ws, v_ws + 1, 'approved', 250, 'already earned' from chores c limit 1
  returning id into v_appr;
  insert into ledger_entries (child_id, type, amount_cents, chore_instance_id, note)
  values (v_child, 'earning', 250, v_appr, 'already earned');

  v_res := excuse_chore(v_tok, v_appr);
  perform assert(coalesce((v_res->>'noop')::boolean, false),
    'excusing an approved chore is refused');
  perform assert(
    (select status from chore_instances where id = v_appr) = 'approved',
    'the approved chore keeps its status');
  perform assert(
    (select count(*) from ledger_entries where chore_instance_id = v_appr) = 1,
    'and keeps its money -- excusing never claws back silently');

  -- ---- a span of days: "Ava is away Friday to Sunday" ----
  delete from chore_instances where chore_name in ('away chore', 'already earned');

  -- One row per day, stated explicitly. `chores CROSS JOIN generate_series
  -- LIMIT 7` looks equivalent but the join order is unspecified, so it can
  -- just as easily return seven copies of day 0 as one of each day.
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select (select id from chores order by name limit 1), v_child, v_ws, v_ws + g, 'pending', 100, 'span ' || g
    from generate_series(0, 6) g;

  -- One for the OTHER child on a day inside the span, which must not move.
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_other, v_ws, v_ws + 3, 'pending', 100, 'not mine' from chores c limit 1;

  -- The seed schedules chores of its own, so count what is genuinely owed in
  -- the span rather than assuming only the rows inserted above are there.
  select count(*) into v_n from chore_instances
   where child_id = v_child and status in ('pending', 'rejected')
     and coalesce(due_date, week_start + 6) between v_ws + 2 and v_ws + 4;

  v_res := excuse_range(v_tok, v_child, v_ws + 2, v_ws + 4);
  perform assert((v_res->>'excused')::int = v_n,
    'excuse_range() excuses everything owed in the span (' || (v_res->>'excused') || ' of ' || v_n || ')');

  perform assert(
    (select count(*) from chore_instances
      where chore_name in ('span 2', 'span 3', 'span 4') and status = 'excused') = 3,
    'the three days inside the span are excused');

  perform assert(
    (select count(*) from chore_instances
      where chore_name in ('span 0', 'span 1', 'span 5', 'span 6')
        and status = 'pending') = 4,
    'the four days outside it are untouched');

  perform assert(
    (select status from chore_instances where chore_name = 'not mine') = 'pending',
    'the other child is untouched');

  -- ---- an "anytime this week" chore is judged by the end of its week ----
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_child, v_ws, null, 'pending', 100, 'anytime one' from chores c limit 1;

  perform excuse_range(v_tok, v_child, v_ws + 6, v_ws + 6);
  perform assert(
    (select status from chore_instances where chore_name = 'anytime one') = 'excused',
    'an anytime chore is excused by the last day of its week');

  -- ---- undoing a span ----
  select count(*) into v_n from chore_instances
   where child_id = v_child and status = 'excused'
     and coalesce(due_date, week_start + 6) between v_ws + 2 and v_ws + 4;

  v_res := unexcuse_range(v_tok, v_child, v_ws + 2, v_ws + 4);
  perform assert((v_res->>'restored')::int = v_n,
    'unexcuse_range() restores exactly what it excused (' || (v_res->>'restored') || ' of ' || v_n || ')');
  perform assert(
    (select count(*) from chore_instances
      where chore_name in ('span 2', 'span 3', 'span 4') and status = 'pending') = 3,
    'those days are back on the list');

  -- ---- a backwards range is refused rather than silently doing nothing ----
  begin
    perform excuse_range(v_tok, v_child, v_ws + 4, v_ws + 1);
    perform assert(false, 'a backwards date range is refused');
  exception when others then
    perform assert(true, 'a backwards date range is refused');
  end;

  -- ---- and none of it works without a parent session ----
  begin
    perform excuse_chore('not-a-real-token', v_inst);
    perform assert(false, 'excusing requires a parent session');
  exception when sqlstate '28000' then
    perform assert(true, 'excusing requires a parent session');
  end;

  begin
    perform excuse_range('not-a-real-token', v_child, v_ws, v_ws + 6);
    perform assert(false, 'excusing a span requires a parent session');
  exception when sqlstate '28000' then
    perform assert(true, 'excusing a span requires a parent session');
  end;

  -- ---- excused work survives start_fresh(), like approved work ----
  --
  -- start_fresh() deletes work "nobody ever acted on", which is pending and
  -- rejected. Excusing IS acting on it: the parent decided the chore was not
  -- owed. If it were swept, generate_week() would put a fresh pending copy
  -- back and the child would be marked down for a day they were away.
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_child, v_ws - 14, v_ws - 12, 'excused', 100, 'old excused' from chores c limit 1;
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, v_child, v_ws - 14, v_ws - 12, 'pending', 100, 'old pending' from chores c limit 1;

  perform start_fresh(v_tok, household_today(), false);

  perform assert(
    (select count(*) from chore_instances where chore_name = 'old excused') = 1,
    'excused work survives start_fresh()');
  perform assert(
    (select count(*) from chore_instances where chore_name = 'old pending') = 0,
    'untouched work is still cleared by start_fresh()');

  raise notice 'EXCUSE TESTS PASSED';
end $$;
