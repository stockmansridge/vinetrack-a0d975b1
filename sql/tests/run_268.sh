#!/usr/bin/env bash
# Throwaway local Postgres; never touches a real database.
set -euo pipefail
D=$(mktemp -d); trap 'pg_ctl -D "$D/db" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
initdb -D "$D/db" -U postgres >/dev/null
pg_ctl -D "$D/db" -o "-k $D -p 55468 -c listen_addresses=''" -l "$D/log" start >/dev/null
R="$(cd "$(dirname "$0")/.." && pwd)"
P="psql -X -q -h $D -p 55468 -U postgres -d postgres -v ON_ERROR_STOP=1"
$P -f "$R/tests/267_pin_row_backfill_harness.sql"
$P -f "$R/tests/268_harness_extras.sql"
$P -f "$R/267_pin_row_backfill_stockmans_ridge.sql"
$P -f "$R/268_pin_row_reconstruction_stockmans_ridge.sql"
$P -f "$R/tests/268_pin_row_reconstruction_tests.sql"
