#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Export values from repo-local env files if present.
set -a
[ -f .env ] && . ./.env
[ -f .env.local ] && . ./.env.local
set +a

# Ensure .fuwa-dev directory exists (for state, reload token, SQLite)
mkdir -p .fuwa-dev

exec tilt up --cwd "$(dirname "$0")" --file infra/Tiltfile "$@"
