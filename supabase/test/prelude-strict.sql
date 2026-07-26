-- The opposite of prelude.sql: a project created with "Automatically expose
-- new tables" switched OFF, so the API roles get nothing by default.
--
-- schema.sql must grant its own read access, or the app can't load. Running
-- the same tests against both preludes proves the schema doesn't silently
-- depend on how that project setting happens to be configured.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;

-- Deliberately NO `alter default privileges` here.

do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;

-- Supabase installs extensions into a dedicated `extensions` schema, NOT public.
-- Reproducing that here matters: a function pinned to `search_path = public`
-- finds pgcrypto on a stock Postgres and fails on Supabase, and without this
-- the tests would never see the difference.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated;
