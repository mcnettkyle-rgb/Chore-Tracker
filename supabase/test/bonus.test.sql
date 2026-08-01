-- Bonus chores at the database level.
--
-- Almost all of the bonus behaviour is scoring, which lives in js/stats.js and
-- is tested there. What the database owns is one thing, and it is the thing
-- that would be silently wrong: is_bonus must be SNAPSHOTTED onto each
-- instance at generation time, exactly like value_cents and chore_name.
--
-- If scoring read chores.is_bonus live instead, then turning an existing chore
-- into a bonus would retroactively erase every miss it ever caused — a child's
-- completion rate for a finished month would change because of an edit made
-- today. Snapshotting is what makes the change take effect going forward only.

\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_tok    text;
  v_child  uuid;
  v_ws     date;
  v_chore  uuid;
  v_asg    uuid;
  v_old    uuid;
  v_n      int;
begin
  raise notice '--- bonus chores ---';

  delete from pin_attempts where id is not null;
  v_tok := parent_unlock('246810')->>'token';
  perform assert(v_tok is not null, 'got a parent session');

  select id into v_child from children order by sort_order limit 1;
  v_ws := week_start_for(household_today());

  -- ---- a bonus chore generates bonus instances ----
  v_chore := upsert_chore(v_tok, jsonb_build_object(
    'name', 'Scrub the bins', 'value_cents', 500, 'is_bonus', true));

  perform assert(
    (select is_bonus from chores where id = v_chore),
    'a chore can be created as a bonus');

  v_asg := upsert_assignment(v_tok, jsonb_build_object(
    'chore_id', v_chore::text,
    'child_id', v_child::text,
    'schedule_type', 'weekly_days',
    'days_of_week', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
    'effective_from', v_ws::text));

  select count(*) into v_n from chore_instances
   where chore_id = v_chore and is_bonus;
  perform assert(v_n > 0, 'generate_week() marks its instances as bonus (' || v_n || ')');

  perform assert(
    (select count(*) from chore_instances where chore_id = v_chore and not is_bonus) = 0,
    'and none of them are marked as ordinary work');

  -- ---- ordinary chores are unaffected ----
  perform assert(
    (select count(*) from chore_instances ci
       join chores c on c.id = ci.chore_id
      where not c.is_bonus and ci.is_bonus) = 0,
    'no ordinary chore was accidentally flagged as bonus');

  -- ---- the snapshot: history must not be rewritten ----
  --
  -- Take an ordinary chore that has already been scored, flip it to a bonus,
  -- and confirm the finished instance keeps its original classification.
  insert into chore_instances (chore_id, child_id, week_start, due_date, status,
                               value_cents, chore_name, is_bonus)
  select c.id, v_child, v_ws - 14, v_ws - 12, 'pending', 100, 'settled history', false
    from chores c where not c.is_bonus limit 1
  returning id, chore_id into v_old, v_chore;

  perform upsert_chore(v_tok, jsonb_build_object('id', v_chore::text, 'is_bonus', true));

  perform assert(
    (select is_bonus from chores where id = v_chore),
    'the chore is now a bonus');
  perform assert(
    (select not is_bonus from chore_instances where id = v_old),
    'a chore instance from a finished week KEEPS its original classification');

  -- ---- but future, untouched work does follow the change ----
  perform assert(
    (select count(*) from chore_instances ci
      where ci.chore_id = v_chore
        and ci.week_start >= v_ws
        and ci.status in ('pending', 'rejected')
        and not ci.is_bonus) = 0,
    'while this week onwards picks the change up');

  -- ---- and flipping it back behaves the same way ----
  perform upsert_chore(v_tok, jsonb_build_object('id', v_chore::text, 'is_bonus', false));
  perform assert(
    (select count(*) from chore_instances ci
      where ci.chore_id = v_chore
        and ci.week_start >= v_ws
        and ci.status in ('pending', 'rejected')
        and ci.is_bonus) = 0,
    'turning it back off updates the same rows');
  perform assert(
    (select not is_bonus from chore_instances where id = v_old),
    'and still leaves the settled instance alone');

  -- ---- a bonus chore is otherwise a completely normal chore ----
  -- It goes through the same submit/approve path and pays the same way; only
  -- the scoring differs, and that is the app's business, not the database's.
  delete from chore_instances where chore_name = 'settled history';

  raise notice 'BONUS TESTS PASSED';
end $$;
