#!/usr/bin/env bash
# Setup PostgreSQL database + user for innovation-bot.
# Usage:
#   ./scripts/setup-db.sh                          # defaults: botuser/botpass/innovation_bot
#   DB_USER=me DB_PASS=secret ./scripts/setup-db.sh
set -euo pipefail

DB_NAME="${DB_NAME:-innovation_bot}"
DB_USER="${DB_USER:-botuser}"
DB_PASS="${DB_PASS:-botpass}"

# On Ubuntu the postgres superuser owns the cluster; on macOS (Homebrew)
# the current user is usually the superuser.
if id postgres &>/dev/null; then
  PSQL=(sudo -u postgres psql)
else
  PSQL=(psql -d postgres)
fi

"${PSQL[@]}" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

# CREATE DATABASE cannot run inside a DO block — check separately.
if ! "${PSQL[@]}" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

"${PSQL[@]}" -v ON_ERROR_STOP=1 -d "${DB_NAME}" \
  -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

echo ""
echo "✅ Database ready. Put this in .env:"
echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
echo ""
echo "Then run migrations:"
echo "  npx prisma migrate dev --name init    # development"
echo "  npx prisma migrate deploy             # production"
