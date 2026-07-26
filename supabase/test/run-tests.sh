#!/usr/bin/env bash
# Runs the database test suite against a throwaway local Postgres.
#
#   ./supabase/test/run-tests.sh
#
# Needs postgresql-16 installed locally. It never touches your Supabase
# project — it spins up its own cluster, runs schema.sql + seed.sql + the
# tests, and tears down.
#
# Everything runs TWICE, against two different project configurations:
#
#   permissive — "Automatically expose new tables" ON. Supabase grants the API
#                roles full privileges on every new table, and row-level
#                security is what holds them back.
#   strict     — that setting OFF. The API roles get nothing by default, so
#                schema.sql has to grant its own read access.
#
# Running both proves the schema behaves identically either way, rather than
# silently depending on how one checkbox happened to be set when the project
# was created.

set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGPORT=${PGPORT:-55432}
PGDATA=${PGDATA:-/var/lib/postgresql/chore-tracker-test}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(dirname "$HERE")"

export PATH="$PGBIN:$PATH"

# Postgres refuses to run as root, so the server is started via `su postgres`.
# Stopping it has to go the same way or the shutdown silently fails and the
# cluster outlives the test run.
if [ "$(id -u)" = "0" ]; then
  RUN="su postgres -c"
else
  RUN="bash -c"
fi

cleanup() {
  $RUN "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# A leftover socket file from a killed run is harmless; a server actually
# listening is not. Test for a live server, then clear any stale socket.
if pg_isready -h /tmp -p "$PGPORT" -q 2>/dev/null; then
  echo "Something is already serving on port $PGPORT — is another test run going?" >&2
  echo "Stop it, or re-run with PGPORT=55499 ./supabase/test/run-tests.sh" >&2
  exit 1
fi
rm -f "/tmp/.s.PGSQL.$PGPORT" "/tmp/.s.PGSQL.$PGPORT.lock"

# Static checks first — they need no database and catch the class of bug that
# only shows up on a real Supabase project (unbounded UPDATEs, search_path).
if command -v node >/dev/null 2>&1; then
  echo "==> SQL lint"
  node "$HERE/lint.mjs"
  echo
fi

echo "==> starting throwaway postgres on port $PGPORT"
rm -rf "$PGDATA"
mkdir -p "$PGDATA"
[ "$(id -u)" = "0" ] && chown postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

$RUN "PATH=$PGBIN:\$PATH initdb -D $PGDATA -A trust -U postgres" >/dev/null
$RUN "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l $PGDATA/server.log start" >/dev/null
sleep 2

# pg_net only exists on Supabase; prelude-net.sql shims it. Strip just the
# CREATE EXTENSION line so the rest of notifications.sql runs unmodified.
sed 's/^create extension if not exists pg_net;/-- pg_net shimmed by prelude-net.sql/' \
  "$SUPA/notifications.sql" > "$PGDATA/notifications.sql"

# Quiet on success (ON_ERROR_STOP + set -e still fail the run), but keep any
# real error text. "does not exist, skipping" is expected noise from the
# idempotent drop-if-exists statements.
run() {
  psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 \
    | grep -vE 'NOTICE:|^$' || true
}

show() {
  psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 \
    | sed 's/^psql.*NOTICE:  //; s/^psql.*ERROR:/ERROR:/' \
    | grep -E "PASS|FAIL|ERROR|---"
}

for MODE in permissive strict; do
  DB="chores_$MODE"
  case "$MODE" in
    permissive) PRELUDE="$HERE/prelude.sql" ;;
    strict)     PRELUDE="$HERE/prelude-strict.sql" ;;
  esac

  echo
  echo "#####################################################################"
  echo "# project config: $MODE  (\"expose new tables\" $([ "$MODE" = permissive ] && echo ON || echo OFF))"
  echo "#####################################################################"

  psql -h /tmp -p "$PGPORT" -U postgres -qc "create database $DB;"

  run "$PRELUDE"
  run "$HERE/prelude-net.sql"
  run "$SUPA/schema.sql"
  run "$SUPA/seed.sql"

  echo "==> core tests"
  show "$HERE/tests.sql"

  echo
  echo "==> notification tests"
  run "$PGDATA/notifications.sql"
  show "$HERE/notifications.test.sql"
done

echo
echo "==> all tests passed under both project configurations"
