-- start_fresh(): drawing a line under a trial run.
--
-- Runs last, because it deletes history the earlier tests depend on.
--
-- The behaviour that actually matters is the interaction with generate_week():
-- deleting old chores is easy, but generation runs on every page load and will
-- happily put them straight back unless it honours the same date.

\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_tok      text;
  v_today    date := current_date;
  v_ws       date;
  v_old      int;
  v_kept     int;
  v_ledger   int;
  v_approved uuid;
  v_child    uuid;
begin
  raise notice '--- start_fresh ---';

  delete from pin_attempts where id is not null;
  v_tok := parent_unlock('246810')->>'token';
  perform assert(v_tok is not null, 'got a parent session');

  v_ws := week_start_for(v_today);

  -- Guarantee there is past history to clear, and one approved chore whose
  -- money must survive.
  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, ch.id, v_ws - 7, v_ws - 5, 'pending', 100, 'old unfinished'
    from chores c cross join children ch limit 1;

  insert into chore_instances (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  select c.id, ch.id, v_ws - 7, v_ws - 5, 'approved', 100, 'old finished'
    from chores c cross join children ch limit 1
  returning id, child_id into v_approved, v_child;

  insert into ledger_entries (child_id, type, amount_cents, chore_instance_id, note)
  values (v_child, 'earning', 100, v_approved, 'old finished');

  select count(*) into v_old from chore_instances
   where coalesce(due_date, week_start + 6) < v_today;
  perform assert(v_old > 0, 'there is past history to clear (' || v_old || ' rows)');

  -- ---- the gentle version ----
  perform start_fresh(v_tok, v_today, false);

  perform assert(
    (select count(*) from chore_instances
      where coalesce(due_date, week_start + 6) < v_today
        and status in ('pending', 'rejected')) = 0,
    'unfinished past chores are gone');

  perform assert(
    (select count(*) from chore_instances where id = v_approved) = 1,
    'an approved past chore is kept');

  perform assert(
    (select count(*) from ledger_entries where chore_instance_id = v_approved) = 1,
    'the money it earned is kept');

  perform assert(
    (get_settings()->>'history_start_date') = to_char(v_today, 'YYYY-MM-DD'),
    'the start date is recorded');

  -- ---- the bit that actually matters ----
  select count(*) into v_kept from chore_instances;
  perform generate_week(v_today);
  perform assert(
    (select count(*) from chore_instances
      where coalesce(due_date, week_start + 6) < v_today
        and status = 'pending') = 0,
    'generate_week does NOT recreate what was cleared');

  perform assert(
    (select count(*) from chore_instances where week_start = v_ws and due_date >= v_today) > 0,
    'chores from the start date onwards are still generated');

  -- ---- the destructive version ----
  select count(*) into v_ledger from ledger_entries;
  perform assert(v_ledger > 0, 'there is money history before wiping');

  perform start_fresh(v_tok, v_today, true);

  perform assert((select count(*) from ledger_entries) = 0, 'wiping money empties the ledger');
  perform assert(
    (select count(*) from chore_instances where coalesce(due_date, week_start + 6) < v_today) = 0,
    'wiping money also removes approved past chores');
  perform assert(
    (select coalesce(sum(balance_cents), 0) from child_balances()) = 0,
    'every balance is back to zero');

  -- ---- still gated ----
  begin
    perform start_fresh('forged-token', v_today, true);
    perform assert(false, 'a forged token must not be able to wipe history');
  exception when sqlstate '28000' then
    raise notice 'PASS  start_fresh requires a real parent session';
  end;

  raise notice 'FRESH-START TESTS PASSED';
end $$;
