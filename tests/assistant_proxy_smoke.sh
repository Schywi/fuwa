#!/usr/bin/env bash
# Live check of the /assistant/ proxy in nginx.conf: every assistant route must
# answer through fuwa's own origin with the prefix stripped.
#
#   ./tests/assistant_proxy_smoke.sh                      # against localhost:8080
#   FUWA_BASE=https://fuwa.local ./tests/assistant_proxy_smoke.sh
#
# Needs a running fuwa (openresty) and a reachable assistant upstream. Prints
# one line per route and exits non-zero if any expectation is not met.

set -uo pipefail

BASE="${FUWA_BASE:-http://localhost:8080}"
A="$BASE/assistant"
SESSION="smoke-$$"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

expect() { # expect <label> <expected-status-regex> <curl args...>
	local label="$1" want="$2"
	shift 2
	local got
	got="$(curl -sS -o "$TMP/body" -w '%{http_code}' "$@" 2>"$TMP/err")" || got="000"
	if [[ "$got" =~ ^($want)$ ]]; then
		printf '  ok   %-22s %s\n' "$label" "$got"
		pass=$((pass + 1))
	else
		printf '  FAIL %-22s %s (want %s)\n' "$label" "$got" "$want"
		[[ -s "$TMP/err" ]] && sed 's/^/         /' "$TMP/err"
		fail=$((fail + 1))
	fi
}

body_contains() { # body_contains <label> <literal>
	if grep -qF -- "$2" "$TMP/body"; then
		printf '  ok   %-22s body has %s\n' "$1" "$2"
		pass=$((pass + 1))
	else
		printf '  FAIL %-22s body lacks %s\n' "$1" "$2"
		fail=$((fail + 1))
	fi
}

echo "assistant proxy smoke → $A"

expect "GET /healthz" "200" "$A/healthz"
expect "GET /" "200" "$A/"
expect "GET /metrics" "200" "$A/metrics"
expect "GET /actions" "200" "$A/actions"

expect "POST /ui/message" "200" -X POST "$A/ui/message" \
	--data-urlencode "message=hello" --data-urlencode "mode=chat" --data-urlencode "session=$SESSION"
cp "$TMP/body" "$TMP/fragment"
body_contains "fragment contract" 'class="msg bot'
body_contains "fragment contract" 'class="speak"'

expect "POST /chat" "200" -X POST "$A/chat" -H 'Content-Type: application/json' \
	-d "{\"message\":\"ping\",\"session\":\"$SESSION\"}"
expect "POST /plan" "200" -X POST "$A/plan" -H 'Content-Type: application/json' -d '{"message":"ping"}'
expect "POST /speak" "200" -X POST "$A/speak" -H 'Content-Type: application/json' -d '{"message":"hi"}'

# 501 is the documented answer until STT_URL is configured.
expect "POST /voice/transcribe" "501" -X POST "$A/voice/transcribe" -F "file=@$0"

# Both routes mint/consume tokens; a bad request must be refused, not proxied away.
expect "POST /actions/request" "200|400|422" -X POST "$A/actions/request" \
	-H 'Content-Type: application/json' -d '{"tool":"get_pods","args":{}}'
expect "POST /actions/confirm" "200|400|404|422" -X POST "$A/actions/confirm" \
	-H 'Content-Type: application/json' -d '{"token":"bogus"}'

# The fragment's own asset path, forwarded through the prefix.
audio="$(grep -o 'data-audio="[^"]*"' "$TMP/fragment" | head -1 | cut -d'"' -f2)"
if [[ -n "$audio" ]]; then
	# The fragment may already carry the prefix (nginx sub_filter) or not.
	case "$audio" in
	/assistant/*) audio_url="$BASE$audio" ;;
	*) audio_url="$A$audio" ;;
	esac
	expect "GET audio/{id}" "200|202" "$audio_url"
else
	printf '  FAIL %-22s fragment carried no data-audio\n' "GET audio/{id}"
	fail=$((fail + 1))
fi

# A non-/assistant path must not be served by the assistant. fuwa answers its
# own catch-all (200) for unknown paths, so assert on the body, not the status.
timeout 10 curl -sS -o "$TMP/body" "$BASE/nope" >/dev/null 2>&1 || true
if grep -qF '<title>Cluster Assistant</title>' "$TMP/body"; then
	printf '  FAIL %-22s fuwa served the assistant page for a non-/assistant path\n' "proxy scope"
	fail=$((fail + 1))
else
	printf '  ok   %-22s not the assistant\n' "proxy scope"
	pass=$((pass + 1))
fi

printf 'assistant proxy smoke: %d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
