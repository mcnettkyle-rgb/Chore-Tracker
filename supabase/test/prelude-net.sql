-- Stands in for the pg_net extension, which only exists on Supabase.
-- net.http_post records the call instead of making it, so the notification
-- tests can assert on exactly what would have been sent.

create schema if not exists net;

create table if not exists net._sent (
  id      serial primary key,
  url     text,
  headers jsonb,
  body    jsonb,
  at      timestamptz default now()
);

-- Signature matches pg_net's, including argument names, since the trigger
-- calls it with named parameters.
create or replace function net.http_post(
  url                   text,
  body                  jsonb default '{}'::jsonb,
  params                jsonb default '{}'::jsonb,
  headers               jsonb default '{}'::jsonb,
  timeout_milliseconds  int   default 5000
)
returns bigint
language plpgsql
as $$
begin
  insert into net._sent (url, headers, body) values (url, headers, body);
  return 1;
end;
$$;
