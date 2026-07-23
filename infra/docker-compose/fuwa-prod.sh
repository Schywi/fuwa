#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/../.."

PORT="${PORT:-8080}"
LUA_BIN="${LUA_BIN:-lua5.4}"

exec socat TCP-LISTEN:"${PORT}",reuseaddr,fork EXEC:"${LUA_BIN} runtime/fuwa-dev.lua"
