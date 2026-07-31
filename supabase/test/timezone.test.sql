-- Dates must be judged in the family's timezone, not the server's.
--
-- Supabase runs in UTC. A household in the Americas is hours behind, so from
-- early evening until midnight local, UTC has already rolled over. Judging a
-- chore's due date against current_date meant a kid doing their chores after
-- dinner was told "This chore is past its due date" for a chore due today.
--
-- To test this without waiting for a particular hour, the household timezone
-- is set to one where the local date provably differs from UTC's. Etc/GMT+12
-- and Etc/GMT-14 are 26 hours apart, so at every instant at least one of them
-- is on a different date to UTC.

\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_tok   text;
  v_zone  text;
  v_local date;
  v_inst  uuid;
  v_child uuid;
  v_chore uuid;
  v_res   jsonb;
begin
  raise notice '--- household timezone ---';

  delete from pin_attempts where id is not null;
  v_tok := parent_unlock('246810')->>'token';

  -- Pick whichever extreme zone is currently on a different date to UTC.
  if (now() at time zone 'Etc/GMT+12')::date <> current_date then
    v_zone := 'Etc/GMT+12';         -- UTC-12, the far west
  else
    v_zone := 'Etc/GMT-14';         -- UTC+14, the far east
  end if;

  perform update_settings(v_tok, jsonb_build_object(
    'timezone', v_zone,
    'allow_late_submission', false,
    'late_grace_days', 0
  ));

  v_local := household_today();
  perform assert(v_local <> current_date,
    format('household_today() is %s in %s while the server says %s', v_local, v_zone, current_date));

  select id into v_child from children limit 1;
  select id into v_chore from chores where not auto_approve limit 1;

  -- A chore due TODAY for this family. With late submission off and zero
  -- grace, judging it against the server's date is exactly the reported bug.
  insert into chore_instances
    (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  values
    (v_chore, v_child, week_start_for(v_local), v_local, 'pending', 100, 'due today locally')
  returning id into v_inst;

  v_res := submit_chore(v_inst);
  perform assert(v_res->>'status' = 'submitted',
    'a chore due today for the family can be submitted, whatever date the server is on');

  -- The rule must still bite for something genuinely past.
  insert into chore_instances
    (chore_id, child_id, week_start, due_date, status, value_cents, chore_name)
  values
    (v_chore, v_child, week_start_for(v_local - 3), v_local - 3, 'pending', 100, 'genuinely late')
  returning id into v_inst;

  begin
    perform submit_chore(v_inst);
    perform assert(false, 'a genuinely late chore must still be refused');
  exception when others then
    perform assert(sqlerrm like '%past its due date%',
      format('a genuinely late chore is still refused ("%s")', sqlerrm));
  end;

  -- Grace days are counted in local terms too.
  perform update_settings(v_tok, jsonb_build_object('late_grace_days', 5));
  v_res := submit_chore(v_inst);
  perform assert(v_res->>'status' = 'submitted', 'grace days are applied against the local date');

  -- An unset timezone must fall back to UTC rather than erroring.
  perform update_settings(v_tok, jsonb_build_object('timezone', ''));
  perform assert(household_today() = current_date, 'a blank timezone falls back to UTC');

  perform update_settings(v_tok, jsonb_build_object('timezone', 'UTC'));
  perform assert(household_today() = current_date, 'an explicit UTC matches the server');

  raise notice 'TIMEZONE TESTS PASSED';
end $$;
