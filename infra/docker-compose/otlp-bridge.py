"""
Fuwa JSON -> OTLP trace bridge.
Receives newline-delimited JSON over TCP, converts supported request-shaped
events into OTLP spans, and forwards them to SigNoz.
"""
import json
import os
import socket
import time
from datetime import datetime
from urllib import request

OTLP_URL = os.getenv("OTLP_URL", "http://signoz-ingester:4318/v1/traces")
LISTEN_PORT = int(os.getenv("LISTEN_PORT", "4321"))
SEED_COUNT = int(os.getenv("SEED_COUNT", "0"))
DECODER = json.JSONDecoder()


def _hex(value: int, width: int) -> str:
    return format(value, f"0{width}x")


def _seed_event(index: int) -> dict:
    status = 500 if index % 11 == 0 else 200
    return {
        "method": "GET",
        "route": "/" if index % 2 == 0 else "/switch/fuwa-gomen",
        "status": status,
        "duration_ms": 25 + (index % 9) * 7,
        "error_total": 1 if status >= 400 else 0,
        "service": "fuwa",
        "timestamp": int((time.time() - (index % 300)) * 1_000_000_000),
    }


def timestamp_to_unix_nano(value) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value:
        normalized = value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp() * 1_000_000_000)
    return int(time.time() * 1_000_000_000)


def normalize_event(event: dict) -> dict | None:
    if not isinstance(event, dict):
        return None
    if event.get("kind") == "request":
        status = int(event.get("status") or (500 if event.get("failed") else 200))
        return {
            "method": event.get("method", "GET"),
            "route": event.get("path", "/"),
            "status": status,
            "duration_ms": int(event.get("duration_ms") or 0),
            "error_total": 1 if status >= 400 else 0,
            "service": "fuwa",
            "timestamp": timestamp_to_unix_nano(event.get("_ts")),
        }
    required = ("method", "route", "status", "duration_ms")
    if all(key in event for key in required):
        return {
            "method": event.get("method", "GET"),
            "route": event.get("route", "/"),
            "status": int(event.get("status", 200)),
            "duration_ms": int(event.get("duration_ms", 0)),
            "error_total": int(event.get("error_total", 0)),
            "service": event.get("service", "fuwa"),
            "timestamp": timestamp_to_unix_nano(event.get("timestamp")),
        }
    return None


def event_to_otlp(event: dict, trace_id_hex: str, span_id_hex: str) -> dict:
    method = event.get("method", "GET")
    route = event.get("route", "/")
    ts = timestamp_to_unix_nano(event.get("timestamp"))
    dur_ns = int(event.get("duration_ms", 0)) * 1_000_000
    status = int(event.get("status", 200))
    return {
        "resourceSpans": [{
            "resource": {
                "attributes": [
                    {"key": "service.name", "value": {"stringValue": event.get("service", "fuwa")}},
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
                    "status": {"code": 1 if status < 400 else 2},
                    "attributes": [
                        {"key": "http.method", "value": {"stringValue": method}},
                        {"key": "http.route", "value": {"stringValue": route}},
                        {"key": "http.status_code", "value": {"intValue": str(status)}},
                    ],
                }]
            }]
        }]
    }


def send_to_signoz(payload: dict) -> bool:
    data = json.dumps(payload).encode()
    req = request.Request(OTLP_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        resp = request.urlopen(req, timeout=3)
        return resp.status == 200
    except Exception as err:
        print(f"signoz error: {err}", flush=True)
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


def seed_traces(count: int):
    for index in range(count):
        event = _seed_event(index + 1)
        payload = event_to_otlp(event, _hex(index + 1, 32), _hex((index + 1) * 2, 16))
        send_to_signoz(payload)


def main():
    if SEED_COUNT > 0:
        seed_traces(SEED_COUNT)

    print(f"bridge listening on :{LISTEN_PORT}", flush=True)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", LISTEN_PORT))
    sock.listen(5)

    counter = max(0, SEED_COUNT)
    while True:
        conn, _addr = sock.accept()
        try:
            def handle_event(event):
                nonlocal counter
                normalized = normalize_event(event)
                if not normalized:
                    return
                counter += 1
                payload = event_to_otlp(normalized, _hex(counter, 32), _hex(counter * 2, 16))
                send_to_signoz(payload)

            process_stream(conn, handle_event)
        finally:
            conn.close()


if __name__ == "__main__":
    main()
