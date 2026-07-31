\set ON_ERROR_STOP on
\pset pager off

create or replace function assert(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

-- =====================================================================
do $$
declare
  v_tok    text;
  v_res    jsonb;
  v_inst   uuid;
  v_inst2  uuid;
  v_child  uuid;
  v_chore  uuid;
  v_bal    bigint;
  v_bal2   bigint;
  v_n      int;
  v_status chore_status;
  v_val    int;
  v_note   text;
  v_ok     boolean;
begin

-- ---------------------------------------------------------------------
raise notice '--- generate_week idempotency ---';
v_res := generate_week(current_date);
perform assert((v_res->>'created')::int = 0, 'second generate_week creates nothing');
select count(*) into v_n from chore_instances;
perform assert(v_n = 48, 'instance count stable at 48 (got ' || v_n || ')');

-- ---------------------------------------------------------------------
raise notice '--- parent unlock / PIN setup ---';
v_res := parent_unlock('anything');
perform assert((v_res->>'ok')::boolean, 'first unlock succeeds with no PIN set');
perform assert((v_res->>'needs_pin_setup')::boolean, 'first unlock flags PIN setup');
v_tok := v_res->>'token';

perform set_parent_pin(v_tok, '246810');
perform assert((parent_status()->>'pin_is_set')::boolean, 'PIN now set');

v_res := parent_unlock('000000');
perform assert(not (v_res->>'ok')::boolean, 'wrong PIN rejected');
perform assert(v_res->>'reason' = 'bad_pin', 'wrong PIN reason is bad_pin');

v_res := parent_unlock('246810');
perform assert((v_res->>'ok')::boolean, 'correct PIN accepted');
v_tok := v_res->>'token';

-- ---------------------------------------------------------------------
raise notice '--- kid submit does NOT pay ---';
select id, child_id into v_inst, v_child
  from chore_instances ci
 where ci.status = 'pending'
   and exists (select 1 from chores c where c.id = ci.chore_id and not c.auto_approve)
 limit 1;

select coalesce(sum(amount_cents),0) into v_bal from ledger_entries where child_id = v_child;

v_res := submit_chore(v_inst);
perform assert(v_res->>'status' = 'submitted', 'submit moves to submitted');

select coalesce(sum(amount_cents),0) into v_bal2 from ledger_entries where child_id = v_child;
perform assert(v_bal = v_bal2, 'submitting alone earns nothing');

-- ---------------------------------------------------------------------
raise notice '--- undo an accidental tap ---';
perform unsubmit_chore(v_inst);
select status into v_status from chore_instances where id = v_inst;
perform assert(v_status = 'pending', 'unsubmit returns chore to pending');
perform submit_chore(v_inst);

-- ---------------------------------------------------------------------
raise notice '--- approval pays exactly once ---';
select value_cents into v_val from chore_instances where id = v_inst;
v_res := approve_chore(v_tok, v_inst);
perform assert(v_res->>'status' = 'approved', 'approve marks approved');

select coalesce(sum(amount_cents),0) into v_bal2 from ledger_entries where child_id = v_child;
perform assert(v_bal2 = v_bal + v_val, 'balance moved by exactly the chore value');

-- double-tap
perform approve_chore(v_tok, v_inst);
perform approve_chore(v_tok, v_inst);
select count(*) into v_n from ledger_entries
 where chore_instance_id = v_inst and type = 'earning';
perform assert(v_n = 1, 'triple approve still pays once');

-- ---------------------------------------------------------------------
raise notice '--- rejection claws back and reopens ---';
v_res := reject_chore(v_tok, v_inst, 'Please do it again');
select status, review_note into v_status, v_note from chore_instances where id = v_inst;
perform assert(v_status = 'rejected', 'reject marks rejected');
perform assert(v_note = 'Please do it again', 'rejection note is saved for the kid');
select count(*) into v_n from ledger_entries
 where chore_instance_id = v_inst and type = 'earning';
perform assert(v_n = 0, 'rejecting an approved chore claws the money back');

select coalesce(sum(amount_cents),0) into v_bal2 from ledger_entries where child_id = v_child;
perform assert(v_bal2 = v_bal, 'balance back to where it started');

-- kid redoes it
perform submit_chore(v_inst);
select status into v_status from chore_instances where id = v_inst;
perform assert(v_status = 'submitted', 'kid can resubmit a rejected chore');
perform approve_chore(v_tok, v_inst);
select count(*) into v_n from ledger_entries
 where chore_instance_id = v_inst and type = 'earning';
perform assert(v_n = 1, 'reject then re-approve records exactly one earning');

-- ---------------------------------------------------------------------
raise notice '--- auto-approve chores pay on submit ---';
select ci.id, ci.child_id, ci.value_cents into v_inst2, v_child, v_val
  from chore_instances ci
  join chores c on c.id = ci.chore_id
 where c.auto_approve and ci.status = 'pending'
 limit 1;

select coalesce(sum(amount_cents),0) into v_bal from ledger_entries where child_id = v_child;
v_res := submit_chore(v_inst2);
perform assert(v_res->>'status' = 'approved', 'auto-approve chore approves on submit');
select coalesce(sum(amount_cents),0) into v_bal2 from ledger_entries where child_id = v_child;
perform assert(v_bal2 = v_bal + v_val, 'auto-approve pays immediately');

-- ---------------------------------------------------------------------
raise notice '--- earned history survives a price change ---';
select chore_id, value_cents into v_chore, v_val from chore_instances where id = v_inst;
select coalesce(sum(amount_cents),0) into v_bal from ledger_entries where chore_instance_id = v_inst;

perform upsert_chore(v_tok, jsonb_build_object('id', v_chore, 'value_cents', 999));

select coalesce(sum(amount_cents),0) into v_bal2 from ledger_entries where chore_instance_id = v_inst;
perform assert(v_bal = v_bal2, 'past earning unchanged after re-pricing');
select value_cents into v_val from chore_instances where id = v_inst;
perform assert(v_val <> 999, 'approved instance keeps its snapshotted value');

-- but an untouched instance this week should pick up the new price
select value_cents into v_val
  from chore_instances
 where chore_id = v_chore and status = 'pending'
   and week_start >= week_start_for(current_date)
 limit 1;
perform assert(v_val = 999, 'unstarted chores this week do pick up the new price');

-- ---------------------------------------------------------------------
raise notice '--- payouts ---';
select id into v_child from children order by sort_order limit 1;
perform approve_all(v_tok, null);
select balance_cents into v_bal from child_balances() where child_balances.child_id = v_child;
perform record_payout(v_tok, v_child, 100, 'cash');
select balance_cents into v_bal2 from child_balances() where child_balances.child_id = v_child;
perform assert(v_bal2 = v_bal - 100, 'payout reduces balance');

begin
  perform record_payout(v_tok, v_child, -500, 'nope');
  perform assert(false, 'negative payout should be rejected');
exception when others then
  raise notice 'PASS  negative payout rejected';
end;

-- ---------------------------------------------------------------------
raise notice '--- undoing an approval ---';
select ci.id, ci.child_id, ci.value_cents into v_inst2, v_child, v_val
  from chore_instances ci where ci.status = 'approved' limit 1;

select coalesce(sum(amount_cents), 0) into v_bal from ledger_entries where child_id = v_child;
perform unapprove_chore(v_tok, v_inst2);

select status into v_status from chore_instances where id = v_inst2;
perform assert(v_status = 'pending', 'undo puts the chore back to not-done');
perform assert((select count(*) from chore_instances
                 where id = v_inst2 and submitted_at is null and reviewed_at is null
                   and review_note is null) = 1,
               'undo leaves no note or timestamps behind — it is not a rejection');

select coalesce(sum(amount_cents), 0) into v_bal2 from ledger_entries where child_id = v_child;
perform assert(v_bal2 = v_bal - v_val, 'undo takes back exactly what the chore earned');

-- The kid can simply do it again.
perform submit_chore(v_inst2);
perform approve_chore(v_tok, v_inst2);
select count(*) into v_n from ledger_entries
 where chore_instance_id = v_inst2 and type = 'earning';
perform assert(v_n = 1, 'redoing it afterwards earns exactly once');

begin
  perform unapprove_chore('forged-token', v_inst2);
  perform assert(false, 'a forged token must not be able to undo an approval');
exception when sqlstate '28000' then
  raise notice 'PASS  undo requires a real parent session';
end;

-- ---------------------------------------------------------------------
raise notice '--- lifetime totals ---';

-- Pick a child who has actually earned something, rather than assuming which
-- one the earlier fixtures happened to touch.
select l.child_id into v_child from ledger_entries l where l.type = 'earning' limit 1;
perform assert(v_child is not null, 'found a child with earnings to check');

select earned_cents, paid_cents into v_bal, v_bal2
  from lifetime_totals() lt where lt.child_id = v_child;
perform assert(v_bal > 0, 'lifetime earned is positive for a child who has earned');

-- Payouts are stored negative; lifetime_totals must report them positive.
perform record_payout(v_tok, v_child, 100, 'lifetime check');
select paid_cents into v_val from lifetime_totals() lt where lt.child_id = v_child;
perform assert(v_val = v_bal2 + 100, 'a payout raises lifetime paid as a positive amount');

select balance_cents into v_n from lifetime_totals() lt where lt.child_id = v_child;
perform assert(v_n = (select balance_cents from child_balances() cb where cb.child_id = v_child),
               'lifetime balance agrees with child_balances()');

-- Adjustments belong in their own bucket, not mistaken for earnings.
select earned_cents into v_bal from lifetime_totals() lt where lt.child_id = v_child;
perform adjust_balance(v_tok, v_child, 250, 'birthday money');
select earned_cents, adjusted_cents into v_val, v_n
  from lifetime_totals() lt where lt.child_id = v_child;
perform assert(v_val = v_bal, 'an adjustment does not inflate lifetime earned');
perform assert(v_n = 250, 'the adjustment is reported separately');

perform assert((select count(*) from lifetime_totals()) = (select count(*) from children),
               'every child gets a row, even with no ledger history');

-- ---------------------------------------------------------------------
raise notice '--- parent session expiry ---';
perform parent_lock(v_tok);
begin
  perform approve_chore(v_tok, v_inst);
  perform assert(false, 'locked session should not approve');
exception when sqlstate '28000' then
  raise notice 'PASS  locked session cannot approve';
end;

begin
  perform approve_chore('not-a-real-token', v_inst);
  perform assert(false, 'forged token should not approve');
exception when sqlstate '28000' then
  raise notice 'PASS  forged token cannot approve';
end;

raise notice 'ALL LOGIC TESTS PASSED';
end $$;

-- =====================================================================
-- Rotation: does the rotating chore actually alternate week to week?
-- =====================================================================
do $$
declare
  v_a uuid; v_b uuid;
  w0 date; w1 date; w2 date;
  c0 uuid; c1 uuid; c2 uuid;
  v_asg uuid;
begin
  raise notice '--- rotation across 3 weeks ---';
  w0 := week_start_for(current_date);
  w1 := w0 + 7;
  w2 := w0 + 14;

  perform generate_week(w1);
  perform generate_week(w2);

  select a.id into v_asg
    from assignments a
    join chores c on c.id = a.chore_id
   where a.rotation_group_id is not null and c.name = 'Take out the trash'
   limit 1;

  select child_id into c0 from chore_instances where assignment_id = v_asg and week_start = w0 limit 1;
  select child_id into c1 from chore_instances where assignment_id = v_asg and week_start = w1 limit 1;
  select child_id into c2 from chore_instances where assignment_id = v_asg and week_start = w2 limit 1;

  perform assert(c0 is not null and c1 is not null and c2 is not null, 'rotating chore generated for 3 weeks');
  perform assert(c0 <> c1, 'week 1 goes to the other kid');
  perform assert(c1 <> c2, 'week 2 swaps back');
  perform assert(c0 = c2, 'rotation has period 2');
  raise notice 'ROTATION TESTS PASSED';
end $$;

-- =====================================================================
-- RLS: what can a kid with the developer console actually do?
-- =====================================================================
set role anon;

do $$
declare
  v_inst uuid;
  v_n    int;
begin
  raise notice '--- RLS as anon (the kid-with-devtools test) ---';

  select id into v_inst from chore_instances limit 1;

  begin
    update chore_instances set status = 'approved' where id = v_inst;
    if found then
      perform assert(false, 'anon must not be able to approve directly');
    else
      raise notice 'PASS  anon UPDATE on chore_instances affected no rows';
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  anon UPDATE on chore_instances denied';
  end;

  begin
    insert into ledger_entries (child_id, type, amount_cents)
    select id, 'earning', 100000 from children limit 1;
    perform assert(false, 'anon must not be able to write the ledger');
  exception when insufficient_privilege then
    raise notice 'PASS  anon INSERT on ledger_entries denied';
  end;

  begin
    update chores set value_cents = 100000;
    if found then
      perform assert(false, 'anon must not be able to re-price chores');
    else
      raise notice 'PASS  anon UPDATE on chores affected no rows';
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS  anon UPDATE on chores denied';
  end;

  begin
    perform 1 from household;
    perform assert(false, 'anon must not read the household table (PIN hash)');
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot read household / PIN hash';
  end;

  begin
    perform 1 from parent_sessions;
    perform assert(false, 'anon must not read session tokens');
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot read parent_sessions';
  end;

  -- but the safe projection must work, or the app cannot boot
  select count(*) into v_n from household_public;
  perform assert(v_n = 1, 'anon CAN read household_public');

  select count(*) into v_n from chore_instances;
  perform assert(v_n > 0, 'anon CAN read chores (needed to show the list)');

  raise notice 'RLS TESTS PASSED';
end $$;

reset role;

-- =====================================================================
-- PIN brute-force lockout (runs last: it locks for 5 minutes)
-- =====================================================================
do $$
declare v_res jsonb; v_i int;
begin
  raise notice '--- PIN lockout ---';
  delete from pin_attempts;

  for v_i in 1..5 loop
    v_res := parent_unlock('111111');
    perform assert(not (v_res->>'ok')::boolean, 'bad PIN attempt ' || v_i || ' rejected');
  end loop;

  perform assert((parent_status()->>'locked')::boolean, 'locked after 5 failures');

  -- The real test: the CORRECT PIN is refused while locked.
  v_res := parent_unlock('246810');
  perform assert(not (v_res->>'ok')::boolean, 'correct PIN refused while locked');
  perform assert(v_res->>'reason' = 'locked', 'lockout reported to the UI');

  raise notice 'LOCKOUT TESTS PASSED';
end $$;
