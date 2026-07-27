"""
fuwa → Signoz + Vector ingestion bridge.

Architecture B: fuwa trace spans → OTLP JSON → Signoz ingester directly.
Also extracts flat HTTP metrics → Vector:8687 for VictoriaMetrics.

Design:
- TraceBuffer accumulates span_start / span_log / span_end events per trace_id.
- When the root "request" span closes, the entire trace tree is converted to
  OTLP resourceSpans and POSTed to Signoz's /v1/traces endpoint.
- Request spans also emit a flat metrics event to Vector for Prometheus counters.
- A background thread flushes stale traces (no root span close after 30 s).
- All HTTP calls are fire-and-forget; ingestion failures never crash the dev server.

Configuration via environment variables:
  FUWA_OTLP_TRACES_URL  – Signoz OTLP traces endpoint (default: http://localhost:4318/v1/traces)
  FUWA_OTLP_LOGS_URL    – Signoz OTLP logs endpoint   (default: http://localhost:4318/v1/logs)
  FUWA_VECTOR_URL       – Vector HTTP ingest endpoint  (default: http://localhost:8687)
  FUWA_INGEST_ENABLED   – set to "0" to disable        (default: enabled)
"""

import hashlib
import json
import os
import threading
import time
import urllib.request
from collections import defaultdict
from typing import Any

# ── Configuration ────────────────────────────────────────────────────────────

OTLP_TRACES_URL = os.getenv(
    "FUWA_OTLP_TRACES_URL", "http://localhost:4318/v1/traces"
)
OTLP_LOGS_URL = os.getenv(
    "FUWA_OTLP_LOGS_URL", "http://localhost:4318/v1/logs"
)
VECTOR_URL = os.getenv("FUWA_VECTOR_URL", "http://localhost:8687")
INGEST_ENABLED = os.getenv("FUWA_INGEST_ENABLED", "1") not in ("0", "false", "no")

STALE_TRACE_TIMEOUT_S = 30.0   # flush traces with no root close after this
FLUSH_INTERVAL_S = 10.0        # how often the background thread checks
HTTP_TIMEOUT_S = 3.0           # fire-and-forget POST timeout


# ── ID conversion ───────────────────────────────────────────────────────────

def _fuwa_id_to_otlp_hex(fuwa_id: str, width: int) -> str:
    """Hash a fuwa trace_id / span_id to a valid OTLP hex string.

    OTLP spec: traceId = 128-bit (32 hex), spanId = 64-bit (16 hex).
    Fuwa IDs are human-readable strings like "trace_6a62e550_1" — not valid hex.
    We hash with MD5 to get a deterministic fixed-width hex string.
    """
    if not fuwa_id:
        return "0" * width
    digest = hashlib.md5(fuwa_id.encode()).hexdigest()
    return digest[:width]


def _timestamp_ns(ts_s: float) -> str:
    """Convert a Unix timestamp (float seconds) to OTLP nanosecond string."""
    return str(int(ts_s * 1_000_000_000))


# ── OTLP span builder ───────────────────────────────────────────────────────

def _build_otlp_span(
    span_id: str,
    start_event: dict[str, Any],
    end_event: dict[str, Any],
    log_events: list[dict[str, Any]],
    trace_id_hex: str,
) -> dict[str, Any] | None:
    """Convert a paired span_start + span_end into an OTLP span dict.

    Returns None if the span data is incomplete or the span should be skipped.
    """
    if not start_event or not end_event:
        return None

    span_id_hex = _fuwa_id_to_otlp_hex(span_id, 16)
    parent_id = end_event.get("parent_id") or start_event.get("parent_id")
    parent_id_hex = _fuwa_id_to_otlp_hex(parent_id, 16) if parent_id else ""

    name = end_event.get("name") or start_event.get("name", "unknown")
    kind = end_event.get("kind", "span_end")

    # Timestamps: use end_event._ts as anchor (Python's ingestion time),
    # subtract duration_ms to get start time. This preserves correct duration
    # even though absolute wall-clock times are approximate.
    end_ts = end_event.get("_ts", time.time())
    duration_ms = float(end_event.get("duration_ms", 0))
    start_ts = end_ts - (duration_ms / 1000.0)

    start_ns = _timestamp_ns(start_ts)
    end_ns = _timestamp_ns(end_ts)

    # Status
    failed = end_event.get("failed", False)
    is_request = kind == "request"
    if is_request:
        status_code = end_event.get("status", 200)
        if isinstance(status_code, str):
            try:
                status_code = int(status_code)
            except ValueError:
                status_code = 0
        has_error = status_code >= 500 or failed
    else:
        status_code = None
        has_error = failed

    # Span kind: SERVER for request spans, INTERNAL for everything else
    span_kind = 2 if is_request else 1  # 2=SERVER, 1=INTERNAL

    # Attributes — merge start + end attrs, prefer end
    attrs: dict[str, Any] = {}
    if isinstance(start_event.get("attrs"), dict):
        attrs.update(start_event["attrs"])
    if isinstance(end_event.get("attrs"), dict):
        attrs.update(end_event["attrs"])

    otlp_attrs: list[dict[str, Any]] = []
    for key, value in attrs.items():
        if value is None:
            continue
        otlp_attrs.append(_attr_to_otlp(str(key), value))

    # For request spans, promote method/path/status to http.* attributes
    if is_request:
        method = end_event.get("method", "")
        path = end_event.get("path", "")
        if method:
            otlp_attrs.insert(0, {"key": "http.method", "value": {"stringValue": str(method)}})
        if path:
            otlp_attrs.insert(1, {"key": "http.route", "value": {"stringValue": str(path)}})
        if status_code is not None:
            otlp_attrs.insert(2, {"key": "http.status_code", "value": {"intValue": str(status_code)}})
        if failed:
            error_msg = end_event.get("error", "")
            if error_msg:
                otlp_attrs.append({"key": "error.message", "value": {"stringValue": str(error_msg)}})

    # Nested span events (from span_log)
    otlp_events: list[dict[str, Any]] = []
    for log_event in log_events:
        log_ts = log_event.get("_ts", end_ts)
        log_attrs: list[dict[str, Any]] = [
            {"key": "message", "value": {"stringValue": str(log_event.get("message", ""))}},
        ]
        if isinstance(log_event.get("fields"), dict):
            for fk, fv in log_event["fields"].items():
                log_attrs.append(_attr_to_otlp(str(fk), fv))
        otlp_events.append({
            "timeUnixNano": _timestamp_ns(log_ts),
            "name": str(log_event.get("name", "log")),
            "attributes": log_attrs,
        })

    span: dict[str, Any] = {
        "traceId": trace_id_hex,
        "spanId": span_id_hex,
        "name": str(name),
        "kind": span_kind,
        "startTimeUnixNano": start_ns,
        "endTimeUnixNano": end_ns,
        "status": {"code": 2 if has_error else 1},
        "attributes": otlp_attrs,
    }

    if parent_id_hex:
        span["parentSpanId"] = parent_id_hex

    if otlp_events:
        span["events"] = otlp_events

    return span


def _attr_to_otlp(key: str, value: Any) -> dict[str, Any]:
    """Convert a fuwa attribute value to an OTLP attribute dict."""
    if isinstance(value, bool):
        return {"key": key, "value": {"boolValue": value}}
    if isinstance(value, int):
        return {"key": key, "value": {"intValue": str(value)}}
    if isinstance(value, float):
        return {"key": key, "value": {"doubleValue": value}}
    return {"key": key, "value": {"stringValue": str(value)}}


# ── Trace buffer ────────────────────────────────────────────────────────────

class TraceBuffer:
    """Accumulates fuwa span events per trace_id, flushes complete traces."""

    def __init__(self, stale_timeout_s: float = STALE_TRACE_TIMEOUT_S):
        self._lock = threading.Lock()
        # trace_id → {spans: {span_id → {start, end, logs}}, root_span_id: str|None}
        self._traces: dict[str, dict[str, Any]] = {}
        self._stale_timeout = stale_timeout_s

    def ingest(self, event: dict[str, Any]) -> list[dict[str, Any]] | None:
        """Process one fuwa trace event.  Returns a list of OTLP payloads
        if one or more traces were flushed, or None."""
        kind = event.get("kind")
        trace_id = event.get("trace_id")
        span_id = event.get("span_id")

        if not trace_id or not span_id:
            return None

        with self._lock:
            trace = self._traces.get(trace_id)
            if trace is None:
                trace = {
                    "spans": {},
                    "root_span_id": None,
                    "first_seen": time.time(),
                    "service": "fuwa-dev",
                }
                self._traces[trace_id] = trace

            span = trace["spans"].get(span_id)
            if span is None:
                span = {"start": None, "end": None, "logs": []}
                trace["spans"][span_id] = span

            if kind == "span_start":
                if span["start"] is None:
                    span["start"] = event
            elif kind == "span_log":
                span["logs"].append(event)
            elif kind in ("span_end", "request"):
                if span["end"] is None:
                    span["end"] = event
                if kind == "request":
                    trace["root_span_id"] = span_id

            # Flush when root span has its end event
            root_sid = trace["root_span_id"]
            if root_sid:
                root_span = trace["spans"].get(root_sid)
                if root_span and root_span.get("end"):
                    return self._flush(trace_id)

        return None

    def flush_stale(self) -> list[dict[str, Any]]:
        """Flush traces that have been buffered too long without a root close."""
        now = time.time()
        payloads: list[dict[str, Any]] = []
        with self._lock:
            stale = [
                tid for tid, t in self._traces.items()
                if now - t["first_seen"] > self._stale_timeout
            ]
            for tid in stale:
                p = self._flush(tid)
                if p:
                    payloads.extend(p)
        return payloads

    def flush_all(self) -> list[dict[str, Any]]:
        """Flush every buffered trace regardless of age.  Called on shutdown."""
        payloads: list[dict[str, Any]] = []
        with self._lock:
            for tid in list(self._traces.keys()):
                p = self._flush(tid)
                if p:
                    payloads.extend(p)
        return payloads

    def _flush(self, trace_id: str) -> list[dict[str, Any]] | None:
        """Build OTLP payload(s) for a trace and remove it from the buffer."""
        trace = self._traces.pop(trace_id, None)
        if not trace:
            return None

        trace_id_hex = _fuwa_id_to_otlp_hex(trace_id, 32)

        spans: list[dict[str, Any]] = []
        for sid, span in trace["spans"].items():
            otlp = _build_otlp_span(
                sid, span["start"], span["end"], span["logs"], trace_id_hex
            )
            if otlp:
                spans.append(otlp)

        if not spans:
            return None

        payload = {
            "resourceSpans": [{
                "resource": {
                    "attributes": [
                        {"key": "service.name",
                         "value": {"stringValue": trace.get("service", "fuwa-dev")}},
                    ]
                },
                "scopeSpans": [{
                    "scope": {"name": "fuwa-runtime", "version": "1.0"},
                    "spans": spans,
                }],
            }]
        }

        return [payload]


# ── HTTP senders ────────────────────────────────────────────────────────────

def _http_post(url: str, payload: dict[str, Any], host_header: str = "") -> bool:
    """Fire-and-forget JSON POST.  Returns True on success (HTTP 2xx)."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if host_header:
        req.add_header("Host", host_header)
    try:
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S)
        if 200 <= resp.status < 300:
            return True
        print(f"[vector_ingest] HTTP {resp.status} from {url}", flush=True)
    except Exception as e:
        print(f"[vector_ingest] POST {url}: {e}", flush=True)
    return False


def send_otlp_traces(payload: dict[str, Any]) -> bool:
    """POST an OTLP resourceSpans payload to Signoz."""
    from urllib.parse import urlparse
    parsed = urlparse(OTLP_TRACES_URL)
    host = parsed.netloc or parsed.hostname or ""
    return _http_post(OTLP_TRACES_URL, payload, host_header=host)


def send_vector_metrics(event: dict[str, Any]) -> None:
    """Extract flat metrics from a request event and fire-and-forget to Vector.

    Spawns a short-lived daemon thread so the caller (add_trace) never blocks.
    Non-request events are silently skipped.
    """
    if event.get("kind") != "request":
        return

    metric_event = {
        "method": event.get("method", "GET"),
        "route": event.get("path", "/"),
        "status": event.get("status", 200),
        "duration_ms": event.get("duration_ms", 0),
        "error_total": 1 if event.get("failed") else 0,
        "request_total": 1,
        "service": "fuwa-dev",
        "timestamp": int(event.get("_ts", time.time()) * 1_000_000_000),
    }

    def _send():
        try:
            _http_post(VECTOR_URL, metric_event)
        except Exception:
            pass

    threading.Thread(target=_send, daemon=True, name="vector-metrics").start()


# ── Background flush thread ─────────────────────────────────────────────────

_buffer = TraceBuffer()
_thread: threading.Thread | None = None
_running = False


def _flush_loop() -> None:
    """Background thread: periodically flush stale traces."""
    global _running
    while _running:
        time.sleep(FLUSH_INTERVAL_S)
        if not _running:
            break
        try:
            payloads = _buffer.flush_stale()
            for p in payloads:
                send_otlp_traces(p)
        except Exception:
            pass


# ── Public API ──────────────────────────────────────────────────────────────

def ingest_event(event: dict[str, Any]) -> None:
    """Main entry point called by dev-server.py for each fuwa trace event.

    Called from add_trace() after the event has been added to the ring buffer.
    Non-blocking: OTLP/Vector POSTs happen inline (fire-and-forget, 3s timeout),
    but they do not block the caller beyond that window.
    """
    if not INGEST_ENABLED:
        return

    try:
        # Extract flat metrics for Vector (only request events produce output)
        send_vector_metrics(event)

        # Buffer and potentially flush OTLP traces
        payloads = _buffer.ingest(event)
        if payloads:
            for p in payloads:
                send_otlp_traces(p)
    except Exception:
        pass  # never let ingestion failures crash the dev server


def start() -> None:
    """Start the background flush thread.  Call once at dev server startup."""
    global _thread, _running
    if not INGEST_ENABLED:
        return
    _running = True
    _thread = threading.Thread(target=_flush_loop, daemon=True, name="vector-ingest-flush")
    _thread.start()
    print("[vector_ingest] started (otlp=%s, vector=%s)" % (OTLP_TRACES_URL, VECTOR_URL),
          flush=True)


def shutdown() -> None:
    """Stop the background thread and flush ALL remaining traces."""
    global _running
    _running = False
    if _thread and _thread.is_alive():
        _thread.join(timeout=5.0)
    # Drain every buffered trace regardless of age
    if INGEST_ENABLED:
        payloads = _buffer.flush_all()
        for p in payloads:
            send_otlp_traces(p)
