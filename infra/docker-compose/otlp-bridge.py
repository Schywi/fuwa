"""
Fuwa → Uptrace OTLP bridge.
Receives fuwa JSON events, converts to OTLP spans, POSTs to uptrace.
Set SEED_COUNT=1000 to generate synthetic traces on startup.
"""
import json
import os
import random
import socket
import time
from datetime import datetime, timezone
from urllib import request

UPTRACE_URL = os.getenv("OTLP_URL", "http://signoz-ingester:4318/v1/traces")
LISTEN_PORT = int(os.getenv("LISTEN_PORT", "4321"))
SEED_COUNT = int(os.getenv("SEED_COUNT", "0"))
DECODER = json.JSONDecoder()

# ── Synthetic trace templates ──────────────────────────────────
METHODS      = ["GET", "GET", "GET", "POST", "PUT", "DELETE"]  # weighted
ROUTES       = ["/", "/dashboard", "/api/data", "/switch/current",
                "/switch/fuwa-gomen", "/login", "/favicon.ico"]
STATUSES     = [200, 200, 200, 200, 200, 200, 200, 201, 301, 404, 500]  # weighted
SERVICES     = ["fuwa", "fuwa-compiler", "fuwa-renderer"]
MIN_DURATION = 2   # ms
MAX_DURATION = 200 # ms


def _hex(n: int, width: int) -> str:
    return format(n, f"0{width}x")


def _random_trace() -> dict:
    method = random.choice(METHODS)
    route = random.choice(ROUTES)
    status = random.choice(STATUSES)
    service = random.choice(SERVICES)
    duration_ms = random.randint(MIN_DURATION, MAX_DURATION)
    # skew: most are fast, occasional outliers
    if random.random() < 0.05:
        duration_ms = random.randint(200, 800)
    if random.random() < 0.01:
        duration_ms = random.randint(1000, 3000)  # real outlier

    # Spread timestamps across the last 2 hours
    ts = int((time.time() - random.randint(0, 7200)) * 1_000_000_000)

    return {
        "method": method,
        "route": route,
        "status": status,
        "duration_ms": duration_ms,
        "error_total": 0 if status < 400 else 1,
        "request_total": 1,
        "service": service,
        "timestamp": ts,
    }


def timestamp_to_unix_nano(value) -> int:
    if isinstance(value, int):
        return value

    if isinstance(value, float):
        return int(value)

    if isinstance(value, str) and value:
        normalized = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        return int(dt.timestamp() * 1_000_000_000)

    return int(time.time() * 1_000_000_000)


# ── OTLP conversion ────────────────────────────────────────────

def event_to_otlp(event: dict, trace_id_hex: str, span_id_hex: str) -> dict:
    method = event.get("method", "GET")
    route = event.get("route", "/")
    ts = timestamp_to_unix_nano(event.get("timestamp"))
    dur_ns = int(event.get("duration_ms", 0)) * 1_000_000
    return {
        "resourceSpans": [{
            "resource": {
                "attributes": [
                    {"key": "service.name",
                     "value": {"stringValue": event.get("service", "fuwa")}},
                ]
            },
            "scopeSpans": [{
                "spans": [{
                    "traceId": trace_id_hex,
                    "spanId": span_id_hex,
                    "name": f"{method} {route}",
                    "kind": 2,
                    "startTimeUnixNano": str(ts),
                    "endTimeUnixNano": str(ts + dur_ns),
                    "status": {"code": 1 if event.get("error_total", 0) == 0 else 2},
                    "attributes": [
                        {"key": "http.method",
                         "value": {"stringValue": method}},
                        {"key": "http.route",
                         "value": {"stringValue": route}},
                        {"key": "http.status_code",
                         "value": {"intValue": str(event.get("status", 200))}},
                    ],
                }]
            }]
        }]
    }


# ── HTTP sender ────────────────────────────────────────────────

def _resolve_target():
    """Resolve OTLP target hostname once, fall back to IP if DNS fails."""
    from urllib.parse import urlparse
    parsed = urlparse(UPTRACE_URL)
    host = parsed.hostname
    port = parsed.port
    # Keep trying DNS until it works (container might still be starting)
    for attempt in range(30):
        try:
            ip = socket.gethostbyname(host)
            resolved = f"http://{ip}:{port}{parsed.path}"
            print(f"resolved {host} → {ip}", flush=True)
            return resolved
        except socket.gaierror:
            if attempt == 0:
                print(f"waiting for DNS for {host}...", flush=True)
            time.sleep(2)
    raise RuntimeError(f"Could not resolve {host} after 60s")

OTLP_RESOLVED = None

def send_to_uptrace(payload: dict) -> bool:
    global OTLP_RESOLVED
    if OTLP_RESOLVED is None:
        OTLP_RESOLVED = _resolve_target()

    data = json.dumps(payload).encode()
    req = request.Request(OTLP_RESOLVED, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Host", "signoz-ingester")  # needed for virtual hosting
    try:
        resp = request.urlopen(req, timeout=3)
        if resp.status != 200:
            print(f"uptrace: HTTP {resp.status}", flush=True)
            return False
        return True
    except Exception as e:
        print(f"uptrace error: {e}", flush=True)
        return False


def extract_events(buffer: str) -> tuple[list[dict], str]:
    events = []
    cursor = 0
    length = len(buffer)

    while cursor < length:
        while cursor < length and buffer[cursor].isspace():
            cursor += 1

        if cursor >= length:
            return events, ""

        try:
            event, next_cursor = DECODER.raw_decode(buffer, cursor)
        except json.JSONDecodeError as err:
            if err.pos >= length:
                return events, buffer[cursor:]

            next_newline = buffer.find("\n", cursor)
            if next_newline == -1:
                return events, ""
            cursor = next_newline + 1
            continue

        if isinstance(event, dict):
            events.append(event)
        cursor = next_cursor

    return events, ""


def process_stream(sock, on_event):
    buffer = ""

    while True:
        data = sock.recv(65536)
        if not data:
            break

        buffer += data.decode("utf-8", errors="ignore")
        events, buffer = extract_events(buffer)
        for event in events:
            on_event(event)


# ── Seeder ─────────────────────────────────────────────────────

def seed_traces(count: int):
    """Generate `count` synthetic traces and ship them to uptrace."""
    print(f"seeding {count} traces...", flush=True)
    ok = 0
    fail = 0
    t0 = time.time()
    for i in range(count):
        trace = _random_trace()
        tid = _hex(i, 32)
        sid = _hex(i * 2, 16)
        otlp = event_to_otlp(trace, tid, sid)
        if send_to_uptrace(otlp):
            ok += 1
        else:
            fail += 1
        if (i + 1) % 250 == 0:
            print(f"  {i + 1}/{count} (ok={ok} fail={fail})", flush=True)
    elapsed = time.time() - t0
    print(f"done: {ok} ok, {fail} failed in {elapsed:.1f}s", flush=True)


# ── Main loop ──────────────────────────────────────────────────

def main():
    if SEED_COUNT > 0:
        seed_traces(SEED_COUNT)

    print(f"bridge listening on :{LISTEN_PORT}", flush=True)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", LISTEN_PORT))
    sock.listen(5)

    counter = SEED_COUNT  # continue trace IDs from after seed
    while True:
        conn, addr = sock.accept()
        try:
            def handle_event(event):
                nonlocal counter
                counter += 1
                tid = _hex(counter, 32)
                sid = _hex(counter * 2, 16)
                otlp = event_to_otlp(event, tid, sid)
                send_to_uptrace(otlp)

            process_stream(conn, handle_event)
        except Exception as e:
            print(f"err: {e}", flush=True)
        finally:
            conn.close()


if __name__ == "__main__":
    main()
