-- Open-ended bonus jobs: no deadline, and no week.
--
-- Everything else in this app is scoped to a week. generate_week() creates a
-- week's chores, the sweep deletes a week's strays, start_fresh() judges by
-- date, and the client fetches one week at a time. An open job breaks that
-- assumption on purpose: it is created once and sits there until it is done.
--
-- So the tests here are all about the week rolling over. The failure modes are
-- duplication (a second copy every week) and disappearance (swept away as
-- unwanted from any week but the one it was born in) — and a disappearance is
-- permanent, because nothing will ever regenerate it.

\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_tok    text;
  v_child  uuid;
  v_ws     date;
  v_chore  uuid;
  v_asg    uuid;
  v_inst   uuid;
  v_n      int;
begin
  raise notice '--- open-ended bonus jobs ---';

  delete from pin_attempts where id is not null;
  v_tok := parent_unlock('246810')->>'token';
  perform assert(v_tok is not null, 'got a parent session');

  select id into v_child from children order by sort_order limit 1;
  v_ws := week_start_for(household_today());

  v_chore := upsert_chore(v_tok, jsonb_build_object(
    'name', 'Sort the loft', 'value_cents', 1000, 'is_bonus', true));

  v_asg := upsert_assignment(v_tok, jsonb_build_object(
    'chore_id', v_chore::text,
    'child_id', v_child::text,
    'schedule_type', 'open',
    'effective_from', v_ws::text));

  -- ---- created exactly once ----
  select count(*) into v_n from chore_instances where assignment_id = v_asg;
  perform assert(v_n = 1, 'one instance is created (' || v_n || ')');

  select id into v_inst from chore_instances where assignment_id = v_asg;
  perform assert((select is_open from chore_instances where id = v_inst),
    'it is flagged as open-ended');
  perform assert((select due_date is null from chore_instances where id = v_inst),
    'and carries no due date');
  perform assert((select is_bonus from chore_instances where id = v_inst),
    'and is a bonus job');

  -- ---- generating the same week again changes nothing ----
  perform generate_week(household_today());
  select count(*) into v_n from chore_instances where assignment_id = v_asg;
  perform assert(v_n = 1, 'regenerating this week does not duplicate it (' || v_n || ')');

  -- ---- nor does generating any FUTURE week ----
  --
  -- This is the one the dedupe index cannot catch: that index is keyed on
  -- week_start, so a second week would happily accept a second copy.
  perform generate_week(household_today() + 7);
  perform generate_week(household_today() + 14);
  select count(*) into v_n from chore_instances where assignment_id = v_asg;
  perform assert(v_n = 1, 'generating later weeks does not duplicate it (' || v_n || ')');

  -- ---- and it is not swept away from those other weeks ----
  perform assert(
    (select count(*) from chore_instances where id = v_inst) = 1,
    'the original survives generation of other weeks');
  perform assert(
    (select week_start from chore_instances where id = v_inst) = v_ws,
    'and stays stamped with the week it was created in');

  -- ---- a past week, too ----
  perform generate_week(household_today() - 7);
  perform assert(
    (select count(*) from chore_instances where id = v_inst) = 1,
    'generating an earlier week does not remove it either');

  -- ---- start_fresh() must not delete it ----
  --
  -- Its week_start is old by construction, so a date-based sweep would take
  -- it. "Before the line" is a claim about a deadline, and it has none.
  perform start_fresh(v_tok, household_today(), false);
  perform assert(
    (select count(*) from chore_instances where id = v_inst) = 1,
    'a fresh start leaves it alone');

  perform start_fresh(v_tok, household_today(), true);
  perform assert(
    (select count(*) from chore_instances where id = v_inst) = 1,
    'even a fresh start that wipes the money');

  -- ---- it can still be done, and it pays ----
  perform submit_chore(v_inst);
  perform assert(
    (select status from chore_instances where id = v_inst) = 'submitted',
    'a child can mark it done');

  perform approve_chore(v_tok, v_inst);
  perform assert(
    (select status from chore_instances where id = v_inst) = 'approved',
    'and it can be approved');
  perform assert(
    (select amount_cents from ledger_entries where chore_instance_id = v_inst) = 1000,
    'paying the full amount');

  -- ---- once done it is NOT reissued ----
  --
  -- "Until it's done" has to mean done. Regenerating would turn a one-off job
  -- into an infinite money printer.
  perform generate_week(household_today());
  perform generate_week(household_today() + 7);
  select count(*) into v_n from chore_instances where assignment_id = v_asg;
  perform assert(v_n = 1, 'a finished open job is not reissued (' || v_n || ')');

  -- ---- switching the assignment off is how you remove one ----
  perform delete_assignment(v_tok, v_asg);
  perform assert(
    (select count(*) from chore_instances where id = v_inst) = 1,
    'archiving keeps the finished history, as everywhere else');

  raise notice 'OPEN-ENDED TESTS PASSED';
end $$;
