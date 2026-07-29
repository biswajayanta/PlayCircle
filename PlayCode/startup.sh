#!/bin/bash
# Runs all schema files, then seed files, against a local Postgres
# database called "playcircle". Idempotent-ish: safe to re-run schema
# (uses CREATE SCHEMA/TABLE IF NOT EXISTS where it matters); seed files
# use ON CONFLICT DO NOTHING so re-running won't duplicate data.
#
# Usage:
#   ./setup.sh                     # uses local `postgres` superuser
#   DB_NAME=playcircle ./setup.sh  # override db name if needed

set -e

DB_NAME="${DB_NAME:-playcircle}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Creating database '$DB_NAME' if it doesn't exist..."
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
    psql -U postgres -c "CREATE DATABASE $DB_NAME"

echo "Running schema files..."
for f in "$DIR"/schema/*.sql; do
    echo "  -> $f"
    psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f"
done

echo "Running seed files..."
for f in "$DIR"/seed/*.sql; do
    echo "  -> $f"
    psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f"
done

echo "Done. Connect with: psql -U postgres -d $DB_NAME"
