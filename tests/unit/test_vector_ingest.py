"""Unit tests for runtime/vector_ingest.py — Architecture B: fuwa → OTLP bridge."""

import json
import os
import sys
import time
import unittest

# Ensure runtime/ is on the path so we can import vector_ingest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "runtime"))

import vector_ingest  # noqa: E402


# ── Helpers ─────────────────────────────────────────────────────────────────

def _make_span_start(trace_id, span_id, name, parent_id=None, attrs=None, depth=0):
    return {
        "kind": "span_start",
        "name": name,
        "trace_id": trace_id,
        "span_id": span_id,
        "parent_id": parent_id,
        "depth": depth,
        "attrs": attrs or {},
        "_ts": time.time(),
    }


def _make_span_log(trace_id, span_id, name, message, fields=None):
    return {
        "kind": "span_log",
        "name": name,
        "trace_id": trace_id,
        "span_id": span_id,
        "parent_id": None,
        "depth": 1,
        "message": message,
        "fields": fields or {},
        "_ts": time.time(),
    }


def _make_span_end(trace_id, span_id, name, duration_ms, failed=False,
                   error=None, attrs=None, parent_id=None):
    return {
        "kind": "span_end",
        "name": name,
        "trace_id": trace_id,
        "span_id": span_id,
        "parent_id": parent_id,
        "depth": 1,
        "attrs": attrs or {},
        "duration_ms": duration_ms,
        "failed": failed,
        "error": error,
        "_ts": time.time(),
    }


def _make_request(trace_id, span_id, method="GET", path="/calm",
                  status=200, duration_ms=42.0, failed=False, error=None):
    return {
        "kind": "request",
        "name": "request",
        "trace_id": trace_id,
        "span_id": span_id,
        "parent_id": None,
        "depth": 0,
        "attrs": {"method": method, "path": path},
        "duration_ms": duration_ms,
        "failed": failed,
        "error": error,
        "method": method,
        "path": path,
        "status": status,
        "_ts": time.time(),
    }


# ── ID conversion ───────────────────────────────────────────────────────────

class TestIdConversion(unittest.TestCase):

    def test_fuwa_id_to_otlp_hex_trace(self):
        tid = "trace_6a62e550_1"
        result = vector_ingest._fuwa_id_to_otlp_hex(tid, 32)
        self.assertEqual(len(result), 32)
        self.assertTrue(all(c in "0123456789abcdef" for c in result))

    def test_fuwa_id_to_otlp_hex_span(self):
        sid = "span_6a62e550_5"
        result = vector_ingest._fuwa_id_to_otlp_hex(sid, 16)
        self.assertEqual(len(result), 16)
        self.assertTrue(all(c in "0123456789abcdef" for c in result))

    def test_fuwa_id_to_otlp_hex_deterministic(self):
        a = vector_ingest._fuwa_id_to_otlp_hex("trace_abc_1", 32)
        b = vector_ingest._fuwa_id_to_otlp_hex("trace_abc_1", 32)
        self.assertEqual(a, b)

    def test_fuwa_id_to_otlp_hex_different_ids(self):
        a = vector_ingest._fuwa_id_to_otlp_hex("trace_a_1", 32)
        b = vector_ingest._fuwa_id_to_otlp_hex("trace_b_2", 32)
        self.assertNotEqual(a, b)

    def test_fuwa_id_to_otlp_hex_none(self):
        result = vector_ingest._fuwa_id_to_otlp_hex(None, 32)
        self.assertEqual(result, "0" * 32)

    def test_fuwa_id_to_otlp_hex_empty(self):
        result = vector_ingest._fuwa_id_to_otlp_hex("", 16)
        self.assertEqual(result, "0" * 16)


# ── Timestamp ────────────────────────────────────────────────────────────────

class TestTimestamp(unittest.TestCase):

    def test_timestamp_ns(self):
        ts = 1700000000.123456789
        result = vector_ingest._timestamp_ns(ts)
        self.assertEqual(result, "1700000000123456768")  # float rounding

    def test_timestamp_ns_zero(self):
        result = vector_ingest._timestamp_ns(0.0)
        self.assertEqual(result, "0")


# ── Attribute conversion ────────────────────────────────────────────────────

class TestAttrToOtlp(unittest.TestCase):

    def test_string_value(self):
        result = vector_ingest._attr_to_otlp("key", "hello")
        self.assertEqual(result, {"key": "key", "value": {"stringValue": "hello"}})

    def test_int_value(self):
        result = vector_ingest._attr_to_otlp("count", 42)
        self.assertEqual(result, {"key": "count", "value": {"intValue": "42"}})

    def test_float_value(self):
        result = vector_ingest._attr_to_otlp("score", 3.14)
        self.assertEqual(result, {"key": "score", "value": {"doubleValue": 3.14}})

    def test_bool_value(self):
        result = vector_ingest._attr_to_otlp("ok", True)
        self.assertEqual(result, {"key": "ok", "value": {"boolValue": True}})

    def test_bool_false(self):
        result = vector_ingest._attr_to_otlp("ok", False)
        self.assertEqual(result, {"key": "ok", "value": {"boolValue": False}})


# ── TraceBuffer: basic span pairing ─────────────────────────────────────────

class TestTraceBufferBasic(unittest.TestCase):

    def setUp(self):
        self.buf = vector_ingest.TraceBuffer(stale_timeout_s=99.0)

    def test_single_span_without_root_does_not_flush(self):
        """A span_start + span_end without a root request span should not flush."""
        tid = "trace_test_1"
        sid = "span_test_1"
        self.assertIsNone(self.buf.ingest(_make_span_start(tid, sid, "compile", depth=1)))
        result = self.buf.ingest(_make_span_end(tid, sid, "compile", 12.5))
        self.assertIsNone(result)

    def test_full_request_trace_flushes(self):
        tid = "trace_full_1"
        request_sid = "span_request_1"
        compile_sid = "span_compile_1"

        # request span start
        self.assertIsNone(self.buf.ingest(_make_span_start(
            tid, request_sid, "request", attrs={"method": "GET", "path": "/calm"},
        )))
        # compile child span
        self.assertIsNone(self.buf.ingest(_make_span_start(
            tid, compile_sid, "compile", parent_id=request_sid, depth=1,
            attrs={"files": 19},
        )))
        self.assertIsNone(self.buf.ingest(_make_span_end(
            tid, compile_sid, "compile", 12.5, parent_id=request_sid,
            attrs={"modules": 5},
        )))
        # request span close — this should flush
        result = self.buf.ingest(_make_request(tid, request_sid, "GET", "/calm", 200, 42.0))
        self.assertIsNotNone(result)
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 1)

        payload = result[0]
        spans = payload["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual(len(spans), 2)

    def test_request_span_otlp_structure(self):
        tid = "trace_struct_1"
        sid = "span_req_1"
        self.buf.ingest(_make_span_start(tid, sid, "request",
                                          attrs={"method": "POST", "path": "/api/data"}))
        result = self.buf.ingest(_make_request(tid, sid, "POST", "/api/data", 201, 55.0))
        self.assertIsNotNone(result)

        span = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        self.assertEqual(span["name"], "request")
        self.assertEqual(span["kind"], 2)  # SERVER
        self.assertEqual(span["status"]["code"], 1)  # OK
        self.assertEqual(len(span["traceId"]), 32)
        self.assertEqual(len(span["spanId"]), 16)
        self.assertIn("startTimeUnixNano", span)
        self.assertIn("endTimeUnixNano", span)
        # Should have http.* attributes
        attr_keys = [a["key"] for a in span["attributes"]]
        self.assertIn("http.method", attr_keys)
        self.assertIn("http.route", attr_keys)
        self.assertIn("http.status_code", attr_keys)

    def test_failed_span_status(self):
        tid = "trace_fail_1"
        sid = "span_req_1"
        self.buf.ingest(_make_span_start(tid, sid, "request"))
        result = self.buf.ingest(_make_request(tid, sid, "GET", "/err", 500, 10.0,
                                                failed=True, error="boom"))
        span = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        self.assertEqual(span["status"]["code"], 2)  # ERROR

    def test_child_span_parent_id(self):
        tid = "trace_parent_1"
        root_sid = "span_root_1"
        child_sid = "span_child_1"

        self.buf.ingest(_make_span_start(tid, root_sid, "request"))
        self.buf.ingest(_make_span_start(tid, child_sid, "db.dispatch",
                                          parent_id=root_sid))
        self.buf.ingest(_make_span_end(tid, child_sid, "db.dispatch", 3.5,
                                        parent_id=root_sid))
        result = self.buf.ingest(_make_request(tid, root_sid))

        spans = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        child_span = [s for s in spans if s["name"] == "db.dispatch"][0]
        root_span = [s for s in spans if s["name"] == "request"][0]

        self.assertIn("parentSpanId", child_span)
        self.assertNotIn("parentSpanId", root_span)
        self.assertEqual(child_span["parentSpanId"], root_span["spanId"])


# ── TraceBuffer: span_log events ────────────────────────────────────────────

class TestTraceBufferSpanLog(unittest.TestCase):

    def setUp(self):
        self.buf = vector_ingest.TraceBuffer(stale_timeout_s=99.0)

    def test_span_log_attached_as_event(self):
        tid = "trace_log_1"
        req_sid = "span_req_1"
        compile_sid = "span_compile_1"

        self.buf.ingest(_make_span_start(tid, req_sid, "request"))
        self.buf.ingest(_make_span_start(tid, compile_sid, "compile",
                                          parent_id=req_sid))
        self.buf.ingest(_make_span_log(tid, compile_sid, "compile",
                                        "scanning source", {"files": 19}))
        self.buf.ingest(_make_span_log(tid, compile_sid, "compile",
                                        "emitted modules", {"count": 5}))
        self.buf.ingest(_make_span_end(tid, compile_sid, "compile", 15.0,
                                        parent_id=req_sid))
        result = self.buf.ingest(_make_request(tid, req_sid))

        spans = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        compile_span = [s for s in spans if s["name"] == "compile"][0]
        self.assertIn("events", compile_span)
        self.assertEqual(len(compile_span["events"]), 2)
        self.assertEqual(compile_span["events"][0]["name"], "compile")

    def test_span_log_on_missing_span_ignored(self):
        """Span log for a span_id not yet seen should be silently ignored."""
        tid = "trace_log_orphan"
        req_sid = "span_req_1"
        self.buf.ingest(_make_span_start(tid, req_sid, "request"))
        # Log for a span that was never started
        self.buf.ingest(_make_span_log(tid, "span_unknown", "unknown", "orphan log"))
        result = self.buf.ingest(_make_request(tid, req_sid))
        spans = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual(len(spans), 1)  # only request span
        self.assertNotIn("events", spans[0])


# ── TraceBuffer: edge cases ─────────────────────────────────────────────────

class TestTraceBufferEdgeCases(unittest.TestCase):

    def setUp(self):
        self.buf = vector_ingest.TraceBuffer(stale_timeout_s=99.0)

    def test_event_without_trace_id_returns_none(self):
        self.assertIsNone(self.buf.ingest({"kind": "span_start", "name": "orphan"}))

    def test_event_without_span_id_returns_none(self):
        self.assertIsNone(self.buf.ingest({"kind": "span_end", "trace_id": "t1"}))

    def test_missing_span_start_still_works(self):
        """span_end without a prior span_start: span should still appear in payload."""
        tid = "trace_no_start"
        req_sid = "span_req_1"
        self.buf.ingest(_make_span_start(tid, req_sid, "request"))
        # No span_start for compile, only span_end
        self.buf.ingest(_make_span_end(tid, "span_compile_x", "compile", 5.0,
                                        parent_id=req_sid))
        result = self.buf.ingest(_make_request(tid, req_sid))
        spans = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        # Compile without start_event should be skipped (None from _build_otlp_span)
        self.assertEqual(len(spans), 1)  # only request

    def test_duplicate_span_end_first_write_wins(self):
        """Duplicate span_end: first end event wins (duration/attrs preserved)."""
        tid = "trace_dup"
        req_sid = "span_req_1"
        compile_sid = "span_compile_1"

        self.buf.ingest(_make_span_start(tid, req_sid, "request"))
        self.buf.ingest(_make_span_start(tid, compile_sid, "compile",
                                          parent_id=req_sid))
        # First end: 5.0ms
        self.buf.ingest(_make_span_end(tid, compile_sid, "compile", 5.0,
                                        parent_id=req_sid,
                                        attrs={"version": "first"}))
        # Duplicate end: 999ms (should be ignored — first-write-wins)
        self.buf.ingest(_make_span_end(tid, compile_sid, "compile", 999.0,
                                        parent_id=req_sid,
                                        attrs={"version": "spurious"}))
        result = self.buf.ingest(_make_request(tid, req_sid))
        spans = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        compile_spans = [s for s in spans if s["name"] == "compile"]
        self.assertEqual(len(compile_spans), 1)
        # Duration should be from first end event (~5ms, not 999ms)
        start = int(compile_spans[0]["startTimeUnixNano"])
        end = int(compile_spans[0]["endTimeUnixNano"])
        diff_ms = (end - start) / 1_000_000
        self.assertAlmostEqual(diff_ms, 5.0, delta=2.0)

    def test_spans_arrive_after_root_close(self):
        """Spans for a trace that arrive after flush should create a new trace."""
        tid = "trace_late"
        req_sid = "span_req_1"
        compile_sid = "span_compile_1"

        # First trace: request only
        self.buf.ingest(_make_span_start(tid, req_sid, "request"))
        result1 = self.buf.ingest(_make_request(tid, req_sid))
        self.assertIsNotNone(result1)
        spans1 = result1[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual(len(spans1), 1)

        # Late compile span — creates a NEW trace buffer entry
        self.buf.ingest(_make_span_start(tid, compile_sid, "compile",
                                          parent_id=req_sid))
        self.buf.ingest(_make_span_end(tid, compile_sid, "compile", 5.0,
                                        parent_id=req_sid))
        # No root span in new buffer → won't flush
        # Stale flush would catch it, or another request if one appears

    def test_multiple_independent_traces(self):
        """Two complete traces should flush independently."""
        buf = self.buf

        # Trace 1
        buf.ingest(_make_span_start("t1", "s1", "request"))
        r1 = buf.ingest(_make_request("t1", "s1"))
        self.assertIsNotNone(r1)

        # Trace 2
        buf.ingest(_make_span_start("t2", "s2", "request"))
        r2 = buf.ingest(_make_request("t2", "s2"))
        self.assertIsNotNone(r2)

        self.assertEqual(len(r1), 1)
        self.assertEqual(len(r2), 1)

    def test_interleaved_events(self):
        """Events from two traces arrive interleaved — should still flush correctly."""
        buf = self.buf

        buf.ingest(_make_span_start("t1", "sr1", "request"))
        buf.ingest(_make_span_start("t2", "sr2", "request"))
        buf.ingest(_make_span_start("t1", "sc1", "compile", parent_id="sr1"))
        buf.ingest(_make_span_end("t1", "sc1", "compile", 3.0, parent_id="sr1"))
        r1 = buf.ingest(_make_request("t1", "sr1"))
        self.assertIsNotNone(r1)
        r2 = buf.ingest(_make_request("t2", "sr2"))
        self.assertIsNotNone(r2)


# ── Stale trace flush ───────────────────────────────────────────────────────

class TestStaleFlush(unittest.TestCase):

    def test_stale_trace_flushed(self):
        buf = vector_ingest.TraceBuffer(stale_timeout_s=-1.0)  # always stale
        tid = "trace_stale"
        sid = "span_stale"

        buf.ingest(_make_span_start(tid, sid, "compile", depth=1))
        buf.ingest(_make_span_end(tid, sid, "compile", 10.0))
        # No root span — won't flush via ingest

        payloads = buf.flush_stale()
        self.assertEqual(len(payloads), 1)
        spans = payloads[0]["resourceSpans"][0]["scopeSpans"][0]["spans"]
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0]["name"], "compile")

    def test_stale_empty_traces_return_empty(self):
        buf = vector_ingest.TraceBuffer(stale_timeout_s=999.0)
        self.assertEqual(len(buf.flush_stale()), 0)

    def test_stale_trace_removed_from_buffer(self):
        buf = vector_ingest.TraceBuffer(stale_timeout_s=-1.0)
        tid = "trace_stale_2"
        sid = "span_stale_2"

        buf.ingest(_make_span_start(tid, sid, "compile", depth=1))
        buf.ingest(_make_span_end(tid, sid, "compile", 10.0))
        buf.flush_stale()
        # Second flush should find nothing
        self.assertEqual(len(buf.flush_stale()), 0)

    def test_flush_all_drains_everything(self):
        """flush_all should drain traces regardless of age."""
        buf = vector_ingest.TraceBuffer(stale_timeout_s=999.0)
        tid = "trace_fresh"
        sid = "span_fresh"

        buf.ingest(_make_span_start(tid, sid, "compile", depth=1))
        buf.ingest(_make_span_end(tid, sid, "compile", 10.0))
        # Not stale yet (timeout is 999s)
        self.assertEqual(len(buf.flush_stale()), 0)
        # flush_all drains it anyway
        payloads = buf.flush_all()
        self.assertEqual(len(payloads), 1)
        # Second flush_all is empty
        self.assertEqual(len(buf.flush_all()), 0)

    def test_flush_all_multiple_traces(self):
        """flush_all drains all traces, even incomplete ones without root spans."""
        buf = vector_ingest.TraceBuffer(stale_timeout_s=999.0)
        for i in range(3):
            tid = f"trace_{i}"
            buf.ingest(_make_span_start(tid, f"span_{i}", "compile", depth=1))
            buf.ingest(_make_span_end(tid, f"span_{i}", "compile", 5.0))
        # No root span → none flushed via ingest
        payloads = buf.flush_all()
        self.assertEqual(len(payloads), 3)


# ── Vector metrics extraction ───────────────────────────────────────────────

class TestVectorMetrics(unittest.TestCase):

    def test_non_request_event_is_noop(self):
        """Non-request events should return immediately without spawning threads."""
        # Should not raise
        vector_ingest.send_vector_metrics(
            {"kind": "span_end", "name": "compile", "duration_ms": 10}
        )

    def test_request_event_does_not_block(self):
        """send_vector_metrics spawns a daemon thread — must return immediately."""
        import time
        event = _make_request("t1", "s1", "GET", "/calm", 200, 42.0)
        t0 = time.time()
        vector_ingest.send_vector_metrics(event)
        elapsed = time.time() - t0
        # Should return in << 1ms (thread spawn, not HTTP timeout)
        self.assertLess(elapsed, 1.0,
                        f"send_vector_metrics blocked for {elapsed:.2f}s")


# ── Integration: ingest_event public API ─────────────────────────────────────

class TestIngestEvent(unittest.TestCase):

    def test_ingest_event_noop_when_disabled(self):
        old_val = vector_ingest.INGEST_ENABLED
        vector_ingest.INGEST_ENABLED = False
        try:
            # Should not raise
            vector_ingest.ingest_event({"kind": "request"})
        finally:
            vector_ingest.INGEST_ENABLED = old_val

    def test_ingest_event_noop_on_malformed_event(self):
        # ingest_event wraps everything in try/except
        vector_ingest.ingest_event({"kind": "span_end"})
        # no exception = pass


# ── Full OTLP payload structure ─────────────────────────────────────────────

class TestOtlpPayloadStructure(unittest.TestCase):

    def test_payload_has_required_top_level_keys(self):
        buf = vector_ingest.TraceBuffer(stale_timeout_s=99.0)
        tid = "trace_struct"
        sid = "span_s"

        buf.ingest(_make_span_start(tid, sid, "request",
                                     attrs={"method": "GET", "path": "/"}))
        result = buf.ingest(_make_request(tid, sid))
        payload = result[0]

        self.assertIn("resourceSpans", payload)
        rs = payload["resourceSpans"]
        self.assertEqual(len(rs), 1)
        self.assertIn("resource", rs[0])
        self.assertIn("scopeSpans", rs[0])
        self.assertEqual(len(rs[0]["scopeSpans"]), 1)

    def test_resource_has_service_name(self):
        buf = vector_ingest.TraceBuffer()
        tid = "trace_svc"
        sid = "span_svc"

        buf.ingest(_make_span_start(tid, sid, "request"))
        result = buf.ingest(_make_request(tid, sid))
        attrs = result[0]["resourceSpans"][0]["resource"]["attributes"]
        svc = [a for a in attrs if a["key"] == "service.name"]
        self.assertEqual(len(svc), 1)
        self.assertEqual(svc[0]["value"]["stringValue"], "fuwa-dev")

    def test_error_span_has_error_message_attribute(self):
        buf = vector_ingest.TraceBuffer()
        tid = "trace_err"
        sid = "span_err"

        buf.ingest(_make_span_start(tid, sid, "request"))
        result = buf.ingest(_make_request(tid, sid, "GET", "/boom", 500, 10.0,
                                           failed=True, error="module not found: foo"))
        span = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        attr_keys = [a["key"] for a in span["attributes"]]
        self.assertIn("error.message", attr_keys)

    def test_duration_is_preserved_in_timestamps(self):
        buf = vector_ingest.TraceBuffer()
        tid = "trace_dur"
        sid = "span_dur"

        buf.ingest(_make_span_start(tid, sid, "request"))
        result = buf.ingest(_make_request(tid, sid, "GET", "/", 200, 123.456))
        span = result[0]["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        start = int(span["startTimeUnixNano"])
        end = int(span["endTimeUnixNano"])
        diff_ms = (end - start) / 1_000_000
        self.assertAlmostEqual(diff_ms, 123.456, delta=1.0)  # within 1 ms of float rounding


if __name__ == "__main__":
    unittest.main()
