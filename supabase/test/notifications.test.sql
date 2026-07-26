-- Tests for the notification trigger in notifications.sql.
--
-- pg_net doesn't exist outside Supabase, so prelude-net.sql shims net.http_post
-- to record calls in a table instead of making them. That lets us assert on
-- exactly what would have been sent.

\set ON_ERROR_STOP on
\pset pager off

-- A pending chore that actually reaches the approval queue. Auto-approve
-- chores jump straight to 'approved', so they would never fire the trigger
-- and must not be used for the coalescing tests.
create or replace function pick_reviewable() returns uuid
language sql as $$
  select ci.id
    from chore_instances ci
    join chores c on c.id = ci.chore_id
   where ci.status = 'pending' and not c.auto_approve
   limit 1;
$$;

do $$
declare
  r      record;
  n      int;
  v_hdrs jsonb;
  v_tok  text;
begin
  raise notice '--- notification trigger ---';

  -- Unconfigured: the trigger must stay silent rather than error. A family
  -- that never sets up notifications still has to be able to mark chores done.
  perform submit_chore(pick_reviewable());
  select count(*) into n from net._sent;
  perform assert(n = 0, 'no POST while notify_function_url is unset');

  insert into private_config (key, value) values
    ('notify_function_url', 'https://example.supabase.co/functions/v1/notify'),
    ('notify_secret',       's3cret')
  on conflict (key) do update set value = excluded.value;

  perform submit_chore(pick_reviewable());
  select count(*) into n from net._sent;
  perform assert(n = 1, 'first submission sends one POST');

  select headers into v_hdrs from net._sent order by id limit 1;
  perform assert(v_hdrs->>'x-notify-secret' = 's3cret', 'shared secret travels as a header');

  -- The point of the coalescing window: five chores in a row is one buzz.
  for r in
    select ci.id from chore_instances ci
      join chores c on c.id = ci.chore_id
     where ci.status = 'pending' and not c.auto_approve
     limit 4
  loop
    perform submit_chore(r.id);
  end loop;
  select count(*) into n from net._sent;
  perform assert(n = 1, 'a burst of 5 submissions still produces exactly one POST');

  update notification_log set sent_at = now() - interval '3 minutes';
  perform submit_chore(pick_reviewable());
  select count(*) into n from net._sent;
  perform assert(n = 2, 'a submission after the window pings again');

  -- Only submissions notify. Approving or rejecting must not buzz the parent
  -- about their own action.
  update notification_log set sent_at = now() - interval '3 minutes';

  -- tests.sql runs first in the same database and deliberately leaves the PIN
  -- locked out. Clear that so we can get a parent session here.
  delete from pin_attempts;
  v_tok := parent_unlock('246810')->>'token';
  perform assert(v_tok is not null, 'got a parent session for the approve/reject checks');
  perform approve_chore(v_tok, (select id from chore_instances where status = 'submitted' limit 1));
  select count(*) into n from net._sent;
  perform assert(n = 2, 'approving does not notify');

  perform reject_chore(v_tok, (select id from chore_instances where status = 'submitted' limit 1), 'redo');
  select count(*) into n from net._sent;
  perform assert(n = 2, 'rejecting does not notify');

  -- Auto-approve chores skip the queue, so they must not notify either.
  update notification_log set sent_at = now() - interval '3 minutes';
  perform submit_chore((
    select ci.id from chore_instances ci
      join chores c on c.id = ci.chore_id
     where c.auto_approve and ci.status = 'pending' limit 1));
  select count(*) into n from net._sent;
  perform assert(n = 2, 'auto-approved chores do not notify');

  raise notice 'NOTIFICATION TESTS PASSED';
end $$;
