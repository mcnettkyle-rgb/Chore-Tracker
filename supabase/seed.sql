-- =====================================================================
-- Sample data — a realistic starting point for two kids (8 and 10).
-- =====================================================================
-- Run this AFTER schema.sql. It only seeds when the children table is
-- empty, so re-running it is harmless.
--
-- The names "Ava" and "Mia" are placeholders. Change them in the app under
-- Parent → Settings → Children, or edit them here before running.
--
-- Everything below is an example, not a recommendation. Chore values, days
-- and assignments are all editable in the app — you should never need to
-- come back to this file.
-- =====================================================================

do $$
declare
  v_ava   uuid;
  v_mia   uuid;
  v_rot   uuid;
  v_chore uuid;
begin
  if exists (select 1 from children) then
    raise notice 'Children already exist — skipping seed.';
    return;
  end if;

  insert into children (name, color, emoji, sort_order)
  values ('Ava', '#e11d48', '🦊', 1) returning id into v_ava;

  insert into children (name, color, emoji, sort_order)
  values ('Mia', '#7c3aed', '🐨', 2) returning id into v_mia;

  -- Chores that alternate week to week, so the unpopular jobs stay fair.
  insert into rotation_groups (name, child_ids, anchor_week)
  values ('Ava & Mia', array[v_ava, v_mia], week_start_for(current_date))
  returning id into v_rot;

  -- ---- Daily, every kid ------------------------------------------------
  insert into chores (name, emoji, description, value_cents)
  values ('Make your bed', '🛏️', 'Covers straight, pillows on top.', 25)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type, days_of_week)
  values (v_chore, v_ava, 'weekly_days', array[0,1,2,3,4,5,6]),
         (v_chore, v_mia, 'weekly_days', array[0,1,2,3,4,5,6]);

  -- auto_approve: a chore you trust without inspecting it. Submitting pays
  -- immediately and it never reaches your approval queue.
  insert into chores (name, emoji, description, value_cents, auto_approve)
  values ('Read for 20 minutes', '📚', 'Any book you like.', 25, true)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type, days_of_week)
  values (v_chore, v_ava, 'weekly_days', array[1,2,3,4,5]),
         (v_chore, v_mia, 'weekly_days', array[1,2,3,4,5]);

  -- ---- Weekday jobs ----------------------------------------------------
  insert into chores (name, emoji, description, value_cents)
  values ('Set the table', '🍽️', 'Plates, cups and forks for everyone.', 40)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type, days_of_week)
  values (v_chore, v_mia, 'weekly_days', array[1,2,3,4,5]);

  insert into chores (name, emoji, description, value_cents)
  values ('Load the dishwasher', '🧼', 'Rinse first, then stack it properly.', 75)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type, days_of_week)
  values (v_chore, v_ava, 'weekly_days', array[1,2,3,4,5]);

  insert into chores (name, emoji, description, value_cents)
  values ('Feed the dog', '🐕', 'One scoop, and fresh water.', 50)
  returning id into v_chore;
  insert into assignments (chore_id, rotation_group_id, schedule_type, days_of_week)
  values (v_chore, v_rot, 'weekly_days', array[0,1,2,3,4,5,6]);

  -- ---- Rotating weekly jobs -------------------------------------------
  insert into chores (name, emoji, description, value_cents)
  values ('Take out the trash', '🗑️', 'Bins to the curb, new bag in.', 100)
  returning id into v_chore;
  insert into assignments (chore_id, rotation_group_id, schedule_type, days_of_week)
  values (v_chore, v_rot, 'weekly_days', array[2]);   -- Tuesdays

  insert into chores (name, emoji, description, value_cents)
  values ('Vacuum the living room', '🧹', 'Under the couch cushions too.', 150)
  returning id into v_chore;
  insert into assignments (chore_id, rotation_group_id, schedule_type, days_of_week)
  values (v_chore, v_rot, 'weekly_days', array[6]);   -- Saturdays

  -- ---- Anytime this week ----------------------------------------------
  insert into chores (name, emoji, description, value_cents)
  values ('Tidy your bedroom', '🧸', 'Floor clear, clothes away.', 100)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type)
  values (v_chore, v_ava, 'anytime'),
         (v_chore, v_mia, 'anytime');

  insert into chores (name, emoji, description, value_cents)
  values ('Put your laundry away', '🧺', 'Folded, in the right drawers.', 75)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type)
  values (v_chore, v_ava, 'anytime'),
         (v_chore, v_mia, 'anytime');

  -- ---- A one-off bonus chore for this week only ------------------------
  insert into chores (name, emoji, description, value_cents)
  values ('Help clean out the garage', '📦', 'Bonus job — big help!', 300)
  returning id into v_chore;
  insert into assignments (chore_id, child_id, schedule_type, oneoff_week)
  values (v_chore, v_ava, 'oneoff', week_start_for(current_date));

  raise notice 'Seeded 2 children and 10 chores.';
end $$;

-- Materialise this week so there is something to look at immediately.
select generate_week(current_date);
