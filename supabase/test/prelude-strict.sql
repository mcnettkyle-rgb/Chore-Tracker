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
