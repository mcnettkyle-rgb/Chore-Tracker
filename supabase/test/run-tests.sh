#!/usr/bin/env bash
# Runs the database test suite against a throwaway local Postgres.
#
#   ./supabase/test/run-tests.sh
#
# Needs postgresql-16 installed locally. It never touches your Supabase
# project — it spins up its own cluster, runs schema.sql + seed.sql + the
# tests, and tears down.
#
# The local cluster grants `anon` full table privileges exactly the way
# Supabase does, so the RLS tests are testing RLS and not a missing GRANT.

set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGPORT=${PGPORT:-55432}
PGDATA=${PGDATA:-/var/lib/postgresql/chore-tracker-test}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(dirname "$HERE")"

export PATH="$PGBIN:$PATH"

cleanup() {
  pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> starting throwaway postgres on port $PGPORT"
rm -rf "$PGDATA"
mkdir -p "$PGDATA"
if [ "$(id -u)" = "0" ]; then
  chown postgres:postgres "$PGDATA"
  RUN="su postgres -c"
else
  RUN="bash -c"
fi
chmod 700 "$PGDATA"

$RUN "PATH=$PGBIN:\$PATH initdb -D $PGDATA -A trust -U postgres" >/dev/null
$RUN "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l $PGDATA/server.log start" >/dev/null
sleep 2

psql -h /tmp -p "$PGPORT" -U postgres -qc "create database chores;"

# Quiet on success (ON_ERROR_STOP + set -e still fail the run), but keep any
# real error text. "does not exist, skipping" is the expected noise from the
# idempotent drop-if-exists statements.
run() {
  psql -h /tmp -p "$PGPORT" -U postgres -d chores -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 \
    | grep -vE 'NOTICE:|^$' || true
}

echo "==> applying schema"
run "$HERE/prelude.sql"
run "$HERE/prelude-net.sql"
run "$SUPA/schema.sql"
run "$SUPA/seed.sql"

show() {
  psql -h /tmp -p "$PGPORT" -U postgres -d chores -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 \
    | sed 's/^psql.*NOTICE:  //; s/^psql.*ERROR:/ERROR:/' \
    | grep -E "PASS|FAIL|ERROR|---"
}

echo "==> core tests"
show "$HERE/tests.sql"

# notifications.sql creates pg_net, which only exists on Supabase; the shim in
# prelude-net.sql provides net.http_post, so drop just that one line.
echo
echo "==> notification tests"
sed 's/^create extension if not exists pg_net;/-- pg_net shimmed by prelude-net.sql/' \
  "$SUPA/notifications.sql" > "$PGDATA/notifications.sql"
run "$PGDATA/notifications.sql"
show "$HERE/notifications.test.sql"

echo
echo "==> all tests passed"
