-- =====================================================================
-- Optional: notify the parent when a chore is marked done.
-- =====================================================================
-- Run this AFTER schema.sql, and only once you have deployed the `notify`
-- Edge Function (see README, "Phone notifications"). The app works fine
-- without it — the in-app badge updates over realtime either way.
--
-- Flow:
--   chore marked done  →  trigger  →  pg_net POST  →  Edge Function
--                                                     ├─ web push to your devices
--                                                     └─ email via Resend
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Where to POST, and the shared secret proving the call came from here.
-- No RLS policies + revoked grants = unreadable through the API.
-- ---------------------------------------------------------------------
create table if not exists private_config (
  key   text primary key,
  value text not null
);

alter table private_config enable row level security;
revoke all on private_config from anon, authenticated;

-- ---------------------------------------------------------------------
-- One row per ping actually sent. Used to coalesce bursts.
-- ---------------------------------------------------------------------
create table if not exists notification_log (
  id      uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  kind    text not null default 'review',
  detail  jsonb
);

alter table notification_log enable row level security;
revoke all on notification_log from anon, authenticated;

create index if not exists notification_log_recent_idx on notification_log (sent_at desc);

-- ---------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------
create or replace function notify_parent_of_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
  v_recent int;
begin
  select value into v_url    from private_config where key = 'notify_function_url';
  if v_url is null or v_url = '' then
    return new;   -- notifications not configured; nothing to do
  end if;

  select value into v_secret from private_config where key = 'notify_secret';

  -- Coalesce bursts: at most one ping every two minutes. Five chores marked
  -- done in a row should buzz your phone once, not five times. The Edge
  -- Function reports the whole queue, so nothing is lost -- a submission
  -- arriving inside the window is included in the next ping, and the in-app
  -- badge is live regardless.
  select count(*) into v_recent
    from notification_log
   where sent_at > now() - interval '2 minutes';

  if v_recent > 0 then
    return new;
  end if;

  insert into notification_log (kind, detail)
  values ('review', jsonb_build_object('instance_id', new.id, 'child_id', new.child_id));

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'x-notify-secret', coalesce(v_secret, '')
               ),
    body    := jsonb_build_object('trigger', 'chore_submitted', 'instance_id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists chore_submitted_notify on chore_instances;

create trigger chore_submitted_notify
  after update on chore_instances
  for each row
  when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function notify_parent_of_submission();

-- =====================================================================
-- Fill these in, then re-run just these two statements.
-- =====================================================================
--   insert into private_config (key, value) values
--     ('notify_function_url', 'https://YOUR-PROJECT.supabase.co/functions/v1/notify'),
--     ('notify_secret',       'some-long-random-string')
--   on conflict (key) do update set value = excluded.value;
--
-- The same random string goes into the Edge Function as the NOTIFY_SECRET
-- environment variable:
--   supabase secrets set NOTIFY_SECRET=some-long-random-string
-- =====================================================================
