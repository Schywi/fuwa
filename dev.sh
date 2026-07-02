#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
LUA_BIN="${LUA_BIN:-lua5.4}"

mkdir -p payloads/current .fuwa-dev
: > .fuwa-dev/reload-token
[ -f .fuwa-dev/state.lua ] || printf 'return {}\n' > .fuwa-dev/state.lua
: > .fuwa-dev/state.lua.lock

inotifywait -m -r -e modify,create,delete,move payloads/current/ \
  | while read -r _; do touch .fuwa-dev/reload-token; done &
WATCH_PID=$!
trap 'kill "$WATCH_PID" 2>/dev/null || true' EXIT

echo "fuwa dev running on http://localhost:${PORT}"
socat TCP-LISTEN:"${PORT}",reuseaddr,fork EXEC:"${LUA_BIN} runtime/fuwa-dev.lua"
