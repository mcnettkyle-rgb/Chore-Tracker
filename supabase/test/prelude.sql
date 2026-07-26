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
