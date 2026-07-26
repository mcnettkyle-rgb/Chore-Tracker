-- Emulate the Supabase environment locally so schema.sql runs unmodified.
-- Crucially, Supabase grants anon full table privileges by default and relies
-- on RLS to restrict it. Reproducing that is what makes the RLS tests real.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;

-- Supabase installs extensions into a dedicated `extensions` schema, NOT public.
-- Reproducing that here matters: a function pinned to `search_path = public`
-- finds pgcrypto on a stock Postgres and fails on Supabase, and without this
-- the tests would never see the difference.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated;
