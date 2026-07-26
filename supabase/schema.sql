-- =====================================================================
-- Chore & Allowance Tracker — database schema
-- =====================================================================
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query → paste → Run). Safe to re-run: everything is idempotent.
--
-- SECURITY MODEL
-- --------------
-- The anon key is public (it ships in the page source). That is fine here
-- only because anon has SELECT and nothing else. Every write goes through
-- a SECURITY DEFINER function:
--
--   * Kids call submit_chore() / unsubmit_chore(). Those can ONLY move a
--     chore between pending/rejected and submitted. They cannot approve,
--     cannot set a dollar value, cannot touch the ledger.
--   * Every parent action requires a session token from parent_unlock(),
--     which requires the PIN. The PIN is stored as a pgcrypto hash and is
--     never readable through the API.
--
-- This stops a curious kid with the developer console, which is the real
-- threat model. It is not bank-grade and no real money moves through it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- pgcrypto provides crypt(), gen_salt() and gen_random_bytes(), which hash
-- the parent PIN and mint session tokens.
--
-- Where it lives differs by host: Supabase keeps extensions in a dedicated
-- `extensions` schema, while a stock Postgres puts them in `public`. Every
-- function below therefore sets `search_path = public, extensions` — a schema
-- that doesn't exist is ignored, so the same script works on both.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      create extension pgcrypto with schema extensions;
    else
      create extension pgcrypto;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type schedule_type as enum ('weekly_days', 'anytime', 'oneoff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chore_status as enum ('pending', 'submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_type as enum ('earning', 'payout', 'adjustment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Single-row table. The `singleton` trick makes a second row impossible.
create table if not exists household (
  id              uuid primary key default gen_random_uuid(),
  singleton       boolean not null default true unique check (singleton),
  name            text not null default 'Our Household',
  parent_pin_hash text,
  settings        jsonb not null default jsonb_build_object(
                    'week_start_day',          0,      -- 0 = Sunday, 1 = Monday
                    'currency_symbol',         '$',
                    'allow_late_submission',   true,
                    'late_grace_days',         3,
                    'notify_push',             true,
                    'notify_email',            true,
                    'notify_email_to',         '',
                    'quiet_hours_start',       21,
                    'quiet_hours_end',         7,
                    -- Set automatically from the parent's browser the first
                    -- time Settings is opened; quiet hours are evaluated in it.
                    'timezone',                'UTC',
                    'parent_session_minutes',  240
                  ),
  created_at      timestamptz not null default now()
);

create table if not exists children (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#6366f1',
  emoji      text not null default '⭐',
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists chores (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  emoji        text not null default '✅',
  description  text not null default '',
  value_cents  int  not null default 50 check (value_cents >= 0),
  auto_approve boolean not null default false,  -- trivial chores that skip review
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Chores that alternate between kids week to week.
create table if not exists rotation_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  child_ids   uuid[] not null check (array_length(child_ids, 1) > 0),
  anchor_week date not null default date '2026-01-04',
  created_at  timestamptz not null default now()
);

-- The weekly template. Instances are generated from these.
create table if not exists assignments (
  id                   uuid primary key default gen_random_uuid(),
  chore_id             uuid not null references chores(id) on delete cascade,
  child_id             uuid references children(id) on delete cascade,
  rotation_group_id    uuid references rotation_groups(id) on delete cascade,
  schedule_type        schedule_type not null default 'weekly_days',
  days_of_week         int[] not null default '{}',  -- 0 = Sunday .. 6 = Saturday
  oneoff_week          date,                          -- only for schedule_type = 'oneoff'
  value_cents_override int check (value_cents_override >= 0),
  active               boolean not null default true,
  effective_from       date not null default current_date,
  effective_to         date,
  created_at           timestamptz not null default now(),

  constraint assignment_has_one_assignee check (
    (child_id is not null and rotation_group_id is null) or
    (child_id is null and rotation_group_id is not null)
  ),
  constraint weekly_days_needs_days check (
    schedule_type <> 'weekly_days' or array_length(days_of_week, 1) > 0
  ),
  constraint oneoff_needs_week check (
    schedule_type <> 'oneoff' or oneoff_week is not null
  )
);

-- One chore, one kid, one week. Name/emoji/value are SNAPSHOTTED at
-- generation time so editing the catalog never rewrites earned history.
create table if not exists chore_instances (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references assignments(id) on delete set null,
  chore_id      uuid references chores(id) on delete set null,
  child_id      uuid not null references children(id) on delete cascade,
  week_start    date not null,
  due_date      date,                        -- null for 'anytime' / 'oneoff'
  status        chore_status not null default 'pending',
  value_cents   int  not null,
  chore_name    text not null,
  chore_emoji   text not null default '✅',
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now()
);

-- Makes generate_week() idempotent.
create unique index if not exists chore_instances_dedupe
  on chore_instances (assignment_id, child_id, week_start, (coalesce(due_date, '0001-01-01'::date)))
  where assignment_id is not null;

create index if not exists chore_instances_week_idx  on chore_instances (week_start, child_id);
create index if not exists chore_instances_status_idx on chore_instances (status) where status = 'submitted';

create table if not exists ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  child_id          uuid not null references children(id) on delete cascade,
  type              ledger_type not null,
  amount_cents      int not null,            -- positive earns, negative payouts
  chore_instance_id uuid references chore_instances(id) on delete set null,
  note              text not null default '',
  created_at        timestamptz not null default now()
);

-- A double-tapped Approve button can never pay twice.
create unique index if not exists ledger_one_earning_per_instance
  on ledger_entries (chore_instance_id)
  where type = 'earning' and chore_instance_id is not null;

create index if not exists ledger_child_idx on ledger_entries (child_id, created_at desc);

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  label      text not null default '',
  created_at timestamptz not null default now()
);

-- Brute-force protection for the PIN. Recorded by parent_unlock(), which
-- deliberately returns a status instead of raising, so the failure row
-- actually commits.
create table if not exists pin_attempts (
  id         uuid primary key default gen_random_uuid(),
  succeeded  boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists pin_attempts_recent_idx on pin_attempts (created_at desc);

-- Short-lived tokens so the PIN crosses the wire once per session.
create table if not exists parent_sessions (
  token      text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------
-- Row Level Security: anon may read, never write.
-- ---------------------------------------------------------------------
alter table household          enable row level security;
alter table children           enable row level security;
alter table chores             enable row level security;
alter table rotation_groups    enable row level security;
alter table assignments        enable row level security;
alter table chore_instances    enable row level security;
alter table ledger_entries     enable row level security;
alter table push_subscriptions enable row level security;
alter table pin_attempts       enable row level security;
alter table parent_sessions    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['children','chores','rotation_groups','assignments',
                           'chore_instances','ledger_entries']
  loop
    execute format('drop policy if exists read_all on %I', t);
    execute format('create policy read_all on %I for select using (true)', t);
  end loop;
end $$;

-- household, pin_attempts, parent_sessions and push_subscriptions get NO
-- policies at all, so they are unreadable through the API. The PIN hash and
-- session tokens never leave the database.

-- Safe projection of household for the client.
create or replace view household_public as
  select id,
         name,
         settings,
         (parent_pin_hash is not null) as pin_is_set
  from household;

-- ---------------------------------------------------------------------
-- Table privileges, stated explicitly.
--
-- Supabase projects have a setting called "Automatically expose new tables",
-- which grants the API roles full privileges on anything created in the public
-- schema. Rather than depend on how that switch happens to be set, revoke
-- everything and hand back exactly SELECT. The app then behaves identically
-- either way, and writes are blocked twice over: no policy AND no grant.
--
-- Nothing here is needed for the app to *write*. Every write runs through a
-- SECURITY DEFINER function, which executes as the owner and does not consult
-- these grants at all.
-- ---------------------------------------------------------------------
revoke all on children, chores, rotation_groups, assignments,
               chore_instances, ledger_entries
  from anon, authenticated;

grant select on children, chores, rotation_groups, assignments,
                chore_instances, ledger_entries
  to anon, authenticated;

-- Never readable through the API: PIN hash, session tokens, push endpoints.
revoke all on household, pin_attempts, parent_sessions, push_subscriptions
  from anon, authenticated;

grant select on household_public to anon, authenticated;

-- =====================================================================
-- Helper functions
-- =====================================================================

-- Normalises any date to the start of its week, honouring week_start_day.
create or replace function week_start_for(p_date date)
returns date
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_date - (
    (extract(dow from p_date)::int
     - coalesce((select (settings->>'week_start_day')::int from household limit 1), 0)
     + 7) % 7
  );
$$;

create or replace function get_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((select settings from household limit 1), '{}'::jsonb);
$$;

-- Raises unless the caller holds a live parent session. Sliding expiry:
-- an active parent stays unlocked.
create or replace function require_parent(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_minutes int;
begin
  v_minutes := coalesce((get_settings()->>'parent_session_minutes')::int, 240);

  delete from parent_sessions where expires_at < now();

  update parent_sessions
     set expires_at = now() + make_interval(mins => v_minutes)
   where token = p_token
     and expires_at >= now();

  if not found then
    raise exception 'Parent session expired. Enter your PIN again.'
      using errcode = '28000';
  end if;
end;
$$;

-- =====================================================================
-- PIN / parent session
-- =====================================================================

-- Status for the lock screen. Never exposes the hash.
create or replace function parent_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_fails int;
begin
  select count(*) into v_fails
    from pin_attempts
   where not succeeded and created_at > now() - interval '5 minutes';

  return jsonb_build_object(
    'pin_is_set',      (select parent_pin_hash is not null from household limit 1),
    'recent_failures', v_fails,
    'locked',          v_fails >= 5
  );
end;
$$;

-- Returns a status object rather than raising, so failed attempts commit.
create or replace function parent_unlock(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash    text;
  v_fails   int;
  v_token   text;
  v_minutes int;
  v_expires timestamptz;
begin
  select count(*) into v_fails
    from pin_attempts
   where not succeeded and created_at > now() - interval '5 minutes';

  if v_fails >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select parent_pin_hash into v_hash from household limit 1;

  -- First run: no PIN yet, so let the parent in to set one.
  if v_hash is null then
    v_minutes := coalesce((get_settings()->>'parent_session_minutes')::int, 240);
    v_token   := encode(gen_random_bytes(24), 'hex');
    v_expires := now() + make_interval(mins => v_minutes);
    insert into parent_sessions (token, expires_at) values (v_token, v_expires);
    return jsonb_build_object('ok', true, 'token', v_token,
                              'expires_at', v_expires, 'needs_pin_setup', true);
  end if;

  if crypt(p_pin, v_hash) = v_hash then
    insert into pin_attempts (succeeded) values (true);
    delete from parent_sessions where expires_at < now();

    v_minutes := coalesce((get_settings()->>'parent_session_minutes')::int, 240);
    v_token   := encode(gen_random_bytes(24), 'hex');
    v_expires := now() + make_interval(mins => v_minutes);
    insert into parent_sessions (token, expires_at) values (v_token, v_expires);

    return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires);
  else
    insert into pin_attempts (succeeded) values (false);
    return jsonb_build_object('ok', false, 'reason', 'bad_pin',
                              'attempts_left', greatest(0, 4 - v_fails));
  end if;
end;
$$;

create or replace function parent_lock(p_token text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from parent_sessions where token = p_token;
$$;

create or replace function set_parent_pin(p_token text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);

  if p_new_pin is null or length(trim(p_new_pin)) < 4 then
    raise exception 'PIN must be at least 4 digits.';
  end if;

  -- `where singleton` matches the single household row. Hosts that enable the
  -- safeupdate extension reject any UPDATE or DELETE without a WHERE clause,
  -- and silently losing a PIN write is exactly the failure that guard exists
  -- to prevent -- so every statement below carries a real predicate.
  update household set parent_pin_hash = crypt(p_new_pin, gen_salt('bf', 10))
   where singleton;

  -- Changing the PIN clears the lockout counter.
  delete from pin_attempts where id is not null;
end;
$$;

-- =====================================================================
-- Week generation
-- =====================================================================

-- Materialises chore_instances for a week from the active template.
-- Idempotent: safe to call on every page load, so there is no cron job and
-- no way to "miss" a week.
create or replace function generate_week(p_any_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a          record;
  v_ws       date;
  v_ws_dow   int;
  v_child    uuid;
  v_dow      int;
  v_due      date;
  v_value    int;
  v_n        int;
  v_idx      int;
  v_created  int := 0;
  v_removed  int := 0;
begin
  v_ws     := week_start_for(p_any_date);
  v_ws_dow := extract(dow from v_ws)::int;

  -- Drop untouched chores whose template row was since switched off, so
  -- unscheduling a chore mid-week actually clears it from the kid's list.
  -- Anything submitted/approved/rejected is history and stays put.
  delete from chore_instances ci
   where ci.week_start = v_ws
     and ci.status = 'pending'
     and ci.assignment_id is not null
     and not exists (
       select 1
         from assignments asg
         join chores c on c.id = asg.chore_id
        where asg.id = ci.assignment_id
          and asg.active and c.active
          and asg.effective_from <= v_ws + 6
          and (asg.effective_to is null or asg.effective_to >= v_ws)
     );
  get diagnostics v_removed = row_count;

  for a in
    select asg.*,
           c.name        as c_name,
           c.emoji       as c_emoji,
           c.value_cents as c_value
      from assignments asg
      join chores c on c.id = asg.chore_id
     where asg.active
       and c.active
       and asg.effective_from <= v_ws + 6
       and (asg.effective_to is null or asg.effective_to >= v_ws)
  loop
    -- Resolve who owns it this week.
    if a.child_id is not null then
      v_child := a.child_id;
    else
      -- Whose turn is it? Count whole weeks since the anchor and step
      -- through the group. floor() (not integer division) so weeks before
      -- the anchor rotate the same way weeks after it do.
      select array_length(rg.child_ids, 1),
             floor((v_ws - rg.anchor_week)::numeric / 7)::int
        into v_n, v_idx
        from rotation_groups rg
       where rg.id = a.rotation_group_id;

      if v_n is null or v_n = 0 then
        v_child := null;
      else
        select rg.child_ids[((v_idx % v_n) + v_n) % v_n + 1]
          into v_child
          from rotation_groups rg
         where rg.id = a.rotation_group_id;
      end if;
    end if;

    continue when v_child is null;

    v_value := coalesce(a.value_cents_override, a.c_value);

    if a.schedule_type = 'weekly_days' then
      foreach v_dow in array a.days_of_week loop
        v_due := v_ws + (((v_dow - v_ws_dow) + 7) % 7);
        insert into chore_instances
          (assignment_id, chore_id, child_id, week_start, due_date,
           value_cents, chore_name, chore_emoji)
        values
          (a.id, a.chore_id, v_child, v_ws, v_due,
           v_value, a.c_name, a.c_emoji)
        on conflict do nothing;
        v_created := v_created + (case when found then 1 else 0 end);
      end loop;

    elsif a.schedule_type = 'anytime' then
      insert into chore_instances
        (assignment_id, chore_id, child_id, week_start, due_date,
         value_cents, chore_name, chore_emoji)
      values
        (a.id, a.chore_id, v_child, v_ws, null,
         v_value, a.c_name, a.c_emoji)
      on conflict do nothing;
      v_created := v_created + (case when found then 1 else 0 end);

    elsif a.schedule_type = 'oneoff' and week_start_for(a.oneoff_week) = v_ws then
      insert into chore_instances
        (assignment_id, chore_id, child_id, week_start, due_date,
         value_cents, chore_name, chore_emoji)
      values
        (a.id, a.chore_id, v_child, v_ws, null,
         v_value, a.c_name, a.c_emoji)
      on conflict do nothing;
      v_created := v_created + (case when found then 1 else 0 end);
    end if;
  end loop;

  return jsonb_build_object('week_start', v_ws, 'created', v_created, 'removed', v_removed);
end;
$$;

-- =====================================================================
-- Kid actions — the only writes a child can perform
-- =====================================================================

create or replace function submit_chore(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inst     chore_instances%rowtype;
  v_auto     boolean;
  v_settings jsonb;
  v_grace    int;
begin
  select * into v_inst from chore_instances where id = p_instance_id;
  if not found then
    raise exception 'That chore no longer exists.';
  end if;

  if v_inst.status not in ('pending', 'rejected') then
    -- Already submitted or approved. Not an error worth shouting about.
    return jsonb_build_object('ok', true, 'status', v_inst.status, 'noop', true);
  end if;

  v_settings := get_settings();

  -- Late submissions, if the parent has turned them off.
  if v_inst.due_date is not null
     and not coalesce((v_settings->>'allow_late_submission')::boolean, true) then
    v_grace := coalesce((v_settings->>'late_grace_days')::int, 0);
    if current_date > v_inst.due_date + v_grace then
      raise exception 'This chore is past its due date.';
    end if;
  end if;

  select coalesce(c.auto_approve, false) into v_auto
    from chores c where c.id = v_inst.chore_id;

  if coalesce(v_auto, false) then
    update chore_instances
       set status = 'approved', submitted_at = now(), reviewed_at = now(), review_note = null
     where id = p_instance_id
    returning * into v_inst;

    insert into ledger_entries (child_id, type, amount_cents, chore_instance_id, note)
    values (v_inst.child_id, 'earning', v_inst.value_cents, v_inst.id, v_inst.chore_name)
    on conflict do nothing;

    return jsonb_build_object('ok', true, 'status', 'approved', 'auto', true);
  end if;

  update chore_instances
     set status = 'submitted', submitted_at = now(), reviewed_at = null, review_note = null
   where id = p_instance_id;

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;

-- Undo an accidental tap, while it is still waiting for review.
create or replace function unsubmit_chore(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update chore_instances
     set status = 'pending', submitted_at = null
   where id = p_instance_id and status = 'submitted';

  if not found then
    raise exception 'Too late to undo that one.';
  end if;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- =====================================================================
-- Parent actions — all require a live session token
-- =====================================================================

create or replace function approve_chore(p_token text, p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inst chore_instances%rowtype;
begin
  perform require_parent(p_token);

  update chore_instances
     set status = 'approved', reviewed_at = now(), review_note = null
   where id = p_instance_id
     and status in ('submitted', 'pending', 'rejected')
  returning * into v_inst;

  if not found then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  -- The partial unique index is what actually guarantees single payment;
  -- this just keeps a double-tap from surfacing as an error.
  insert into ledger_entries (child_id, type, amount_cents, chore_instance_id, note)
  values (v_inst.child_id, 'earning', v_inst.value_cents, v_inst.id, v_inst.chore_name)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'status', 'approved',
                            'amount_cents', v_inst.value_cents);
end;
$$;

create or replace function reject_chore(p_token text, p_instance_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);

  update chore_instances
     set status = 'rejected', reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_instance_id
     and status in ('submitted', 'approved');

  if not found then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  -- Claw back the earning if this was previously approved.
  delete from ledger_entries
   where chore_instance_id = p_instance_id and type = 'earning';

  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

create or replace function approve_all(p_token text, p_child_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r     record;
  v_cnt int := 0;
  v_sum int := 0;
begin
  perform require_parent(p_token);

  for r in
    select id from chore_instances
     where status = 'submitted'
       and (p_child_id is null or child_id = p_child_id)
     order by submitted_at
  loop
    v_sum := v_sum + coalesce((approve_chore(p_token, r.id)->>'amount_cents')::int, 0);
    v_cnt := v_cnt + 1;
  end loop;

  return jsonb_build_object('ok', true, 'approved', v_cnt, 'amount_cents', v_sum);
end;
$$;

create or replace function record_payout(
  p_token text, p_child_id uuid, p_amount_cents int, p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payout amount must be greater than zero.';
  end if;

  insert into ledger_entries (child_id, type, amount_cents, note)
  values (p_child_id, 'payout', -p_amount_cents, coalesce(p_note, ''));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function adjust_balance(
  p_token text, p_child_id uuid, p_amount_cents int, p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);

  if coalesce(p_amount_cents, 0) = 0 then
    raise exception 'Adjustment cannot be zero.';
  end if;

  insert into ledger_entries (child_id, type, amount_cents, note)
  values (p_child_id, 'adjustment', p_amount_cents, coalesce(p_note, ''));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Configuration (the parent settings screens)
-- ---------------------------------------------------------------------

create or replace function upsert_child(p_token text, p_child jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform require_parent(p_token);
  v_id := nullif(p_child->>'id', '')::uuid;

  if v_id is null then
    insert into children (name, color, emoji, sort_order, active)
    values (p_child->>'name',
            coalesce(p_child->>'color', '#6366f1'),
            coalesce(p_child->>'emoji', '⭐'),
            coalesce((p_child->>'sort_order')::int, 0),
            coalesce((p_child->>'active')::boolean, true))
    returning id into v_id;
  else
    update children
       set name       = coalesce(p_child->>'name', name),
           color      = coalesce(p_child->>'color', color),
           emoji      = coalesce(p_child->>'emoji', emoji),
           sort_order = coalesce((p_child->>'sort_order')::int, sort_order),
           active     = coalesce((p_child->>'active')::boolean, active)
     where id = v_id;
  end if;

  return v_id;
end;
$$;

-- Re-pricing rule: changing a chore's value updates chores that have not
-- been acted on yet (this week and later). Anything submitted or already
-- approved keeps the price it was earned at.
create or replace function upsert_chore(p_token text, p_chore jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    uuid;
  v_value int;
begin
  perform require_parent(p_token);
  v_id := nullif(p_chore->>'id', '')::uuid;

  if v_id is null then
    insert into chores (name, emoji, description, value_cents, auto_approve, active)
    values (p_chore->>'name',
            coalesce(p_chore->>'emoji', '✅'),
            coalesce(p_chore->>'description', ''),
            coalesce((p_chore->>'value_cents')::int, 50),
            coalesce((p_chore->>'auto_approve')::boolean, false),
            coalesce((p_chore->>'active')::boolean, true))
    returning id into v_id;
  else
    update chores
       set name         = coalesce(p_chore->>'name', name),
           emoji        = coalesce(p_chore->>'emoji', emoji),
           description  = coalesce(p_chore->>'description', description),
           value_cents  = coalesce((p_chore->>'value_cents')::int, value_cents),
           auto_approve = coalesce((p_chore->>'auto_approve')::boolean, auto_approve),
           active       = coalesce((p_chore->>'active')::boolean, active)
     where id = v_id
    returning value_cents into v_value;

    update chore_instances ci
       set value_cents = v_value,
           chore_name  = (select name  from chores where id = v_id),
           chore_emoji = (select emoji from chores where id = v_id)
      from assignments asg
     where ci.assignment_id = asg.id
       and ci.chore_id = v_id
       and ci.status in ('pending', 'rejected')
       and ci.week_start >= week_start_for(current_date)
       and asg.value_cents_override is null;
  end if;

  return v_id;
end;
$$;

create or replace function upsert_assignment(p_token text, p_assignment jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_days int[];
begin
  perform require_parent(p_token);
  v_id := nullif(p_assignment->>'id', '')::uuid;

  select coalesce(array_agg(value::int), '{}')
    into v_days
    from jsonb_array_elements_text(coalesce(p_assignment->'days_of_week', '[]'::jsonb)) as value;

  if v_id is null then
    insert into assignments (chore_id, child_id, rotation_group_id, schedule_type,
                             days_of_week, oneoff_week, value_cents_override,
                             active, effective_from, effective_to)
    values ((p_assignment->>'chore_id')::uuid,
            nullif(p_assignment->>'child_id', '')::uuid,
            nullif(p_assignment->>'rotation_group_id', '')::uuid,
            coalesce(p_assignment->>'schedule_type', 'weekly_days')::schedule_type,
            v_days,
            nullif(p_assignment->>'oneoff_week', '')::date,
            nullif(p_assignment->>'value_cents_override', '')::int,
            coalesce((p_assignment->>'active')::boolean, true),
            coalesce(nullif(p_assignment->>'effective_from', '')::date, current_date),
            nullif(p_assignment->>'effective_to', '')::date)
    returning id into v_id;
  else
    update assignments
       set chore_id             = coalesce(nullif(p_assignment->>'chore_id', '')::uuid, chore_id),
           child_id             = case when p_assignment ? 'child_id'
                                       then nullif(p_assignment->>'child_id', '')::uuid else child_id end,
           rotation_group_id    = case when p_assignment ? 'rotation_group_id'
                                       then nullif(p_assignment->>'rotation_group_id', '')::uuid else rotation_group_id end,
           schedule_type        = coalesce(nullif(p_assignment->>'schedule_type', '')::schedule_type, schedule_type),
           days_of_week         = case when p_assignment ? 'days_of_week' then v_days else days_of_week end,
           oneoff_week          = case when p_assignment ? 'oneoff_week'
                                       then nullif(p_assignment->>'oneoff_week', '')::date else oneoff_week end,
           value_cents_override = case when p_assignment ? 'value_cents_override'
                                       then nullif(p_assignment->>'value_cents_override', '')::int else value_cents_override end,
           active               = coalesce((p_assignment->>'active')::boolean, active),
           effective_from       = coalesce(nullif(p_assignment->>'effective_from', '')::date, effective_from),
           effective_to         = case when p_assignment ? 'effective_to'
                                       then nullif(p_assignment->>'effective_to', '')::date else effective_to end
     where id = v_id;
  end if;

  perform generate_week(current_date);
  return v_id;
end;
$$;

create or replace function delete_assignment(p_token text, p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);
  -- Soft delete: history in chore_instances keeps its snapshotted values.
  update assignments set active = false where id = p_assignment_id;
  perform generate_week(current_date);
end;
$$;

create or replace function upsert_rotation_group(p_token text, p_group jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_ids uuid[];
begin
  perform require_parent(p_token);
  v_id := nullif(p_group->>'id', '')::uuid;

  select coalesce(array_agg(value::uuid), '{}')
    into v_ids
    from jsonb_array_elements_text(coalesce(p_group->'child_ids', '[]'::jsonb)) as value;

  if v_id is null then
    insert into rotation_groups (name, child_ids, anchor_week)
    values (p_group->>'name', v_ids,
            coalesce(nullif(p_group->>'anchor_week', '')::date, week_start_for(current_date)))
    returning id into v_id;
  else
    update rotation_groups
       set name        = coalesce(p_group->>'name', name),
           child_ids   = case when p_group ? 'child_ids' then v_ids else child_ids end,
           anchor_week = coalesce(nullif(p_group->>'anchor_week', '')::date, anchor_week)
     where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function update_settings(p_token text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_settings jsonb;
begin
  perform require_parent(p_token);
  update household set settings = settings || p_patch
   where singleton
  returning settings into v_settings;
  return v_settings;
end;
$$;

create or replace function rename_household(p_token text, p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);
  update household set name = p_name where singleton;
end;
$$;

-- ---------------------------------------------------------------------
-- Push subscription registration (parent devices)
-- ---------------------------------------------------------------------
create or replace function register_push(
  p_token text, p_endpoint text, p_p256dh text, p_auth text, p_label text default ''
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_parent(p_token);

  insert into push_subscriptions (endpoint, p256dh, auth, label)
  values (p_endpoint, p_p256dh, p_auth, coalesce(p_label, ''))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth   = excluded.auth,
        label  = excluded.label;
end;
$$;

create or replace function unregister_push(p_endpoint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;

-- =====================================================================
-- Read helpers
-- =====================================================================

create or replace function child_balances()
returns table (child_id uuid, balance_cents bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.id, coalesce(sum(l.amount_cents), 0)::bigint
    from children c
    left join ledger_entries l on l.child_id = c.id
   group by c.id;
$$;

-- =====================================================================
-- Grants — only the functions above are callable by anon.
-- =====================================================================
grant execute on function
  week_start_for(date),
  get_settings(),
  parent_status(),
  parent_unlock(text),
  parent_lock(text),
  set_parent_pin(text, text),
  generate_week(date),
  submit_chore(uuid),
  unsubmit_chore(uuid),
  approve_chore(text, uuid),
  reject_chore(text, uuid, text),
  approve_all(text, uuid),
  record_payout(text, uuid, int, text),
  adjust_balance(text, uuid, int, text),
  upsert_child(text, jsonb),
  upsert_chore(text, jsonb),
  upsert_assignment(text, jsonb),
  delete_assignment(text, uuid),
  upsert_rotation_group(text, jsonb),
  update_settings(text, jsonb),
  rename_household(text, text),
  register_push(text, text, text, text, text),
  unregister_push(text),
  child_balances()
to anon, authenticated;

-- require_parent is internal plumbing; never expose it.
revoke execute on function require_parent(text) from anon, authenticated;

-- =====================================================================
-- Realtime — drives the live approval badge and the kid's "approved!" toast
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table chore_instances;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table ledger_entries;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Bootstrap the single household row
-- =====================================================================
insert into household (name) values ('Our Household')
on conflict (singleton) do nothing;
