#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Export values from repo-local env files if present.
set -a
[ -f .env ] && . ./.env
[ -f .env.local ] && . ./.env.local
set +a

exec python3 runtime/dev-server.py "$@"
