#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Export values from repo-local env files if present.
set -a
[ -f .env ] && . ./.env
[ -f .env.local ] && . ./.env.local
set +a

export FUWA_HTTP_PORT="${FUWA_HTTP_PORT:-8080}"

mkdir -p .fuwa-dev

tilt down --file infra/Tiltfile 2>/dev/null || true
exec tilt up --file infra/Tiltfile "$@"
