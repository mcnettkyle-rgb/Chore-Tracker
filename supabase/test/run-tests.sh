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

  echo
  echo "==> excusing chores"
  show "$HERE/excuse.test.sql"

  # Last: it deletes history the tests above rely on.
  echo
  echo "==> timezone"
  show "$HERE/timezone.test.sql"

  echo
  echo "==> fresh start"
  show "$HERE/fresh-start.test.sql"
done

# ---------------------------------------------------------------------
# The upgrade path, which is the one that can fail on its own.
#
# Everything above installs schema.sql into an empty database. A live project
# is not empty: its chore_status enum predates 'excused', so applying the new
# file has to ALTER the type rather than create it -- and the Supabase SQL
# editor runs the whole file as ONE transaction, where Postgres refuses to use
# an enum value added in that same transaction.
#
# A fresh install never hits that, so without this step the failure would sail
# through every test above and land only on a real, already-running database.
# ---------------------------------------------------------------------
echo
echo "#####################################################################"
echo "# upgrading a live database (enum predates 'excused', one transaction)"
echo "#####################################################################"

DB=chores_upgrade
psql -h /tmp -p "$PGPORT" -U postgres -qc "create database $DB;"
run "$HERE/prelude.sql"
run "$HERE/prelude-net.sql"

# The chore_status a version-6 database has.
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 \
  -c "create type chore_status as enum ('pending','submitted','approved','rejected');"

# -1 wraps the file in a single transaction, exactly like the SQL editor.
#
# psql's own exit status is what matters here. Piping it through `grep -v` to
# hide NOTICEs would report grep's status instead, and grep exits 1 when it
# filters out every line -- so a completely clean run would read as a failure.
UPGRADE_LOG="$PGDATA/upgrade.log"
if psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -1 -v ON_ERROR_STOP=1 \
     -f "$SUPA/schema.sql" >"$UPGRADE_LOG" 2>&1; then
  echo "PASS  schema.sql applies to a version-6 database in one transaction"
else
  echo "FAIL  schema.sql applies to a version-6 database in one transaction"
  grep -E 'ERROR|HINT|LINE' "$UPGRADE_LOG" | head -10
  exit 1
fi

# And the new value is actually usable once that transaction has committed.
psql -h /tmp -p "$PGPORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 \
  -f "$SUPA/seed.sql" >/dev/null
show "$HERE/upgrade.test.sql"

echo
echo "==> all tests passed under both project configurations"
