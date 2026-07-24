import importlib.util
import pathlib
import unittest


def load_bridge_module():
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    module_path = repo_root / "infra" / "docker-compose" / "otlp-bridge.py"
    spec = importlib.util.spec_from_file_location("otlp_bridge", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


bridge = load_bridge_module()


class ExtractEventsTests(unittest.TestCase):
    def test_extracts_newline_delimited_json(self):
        events, remainder = bridge.extract_events(
            '{"route":"/","status":200}\n{"route":"/login","status":500}\n'
        )

        self.assertEqual(
            events,
            [
                {"route": "/", "status": 200},
                {"route": "/login", "status": 500},
            ],
        )
        self.assertEqual(remainder, "")

    def test_keeps_partial_json_for_next_chunk(self):
        events, remainder = bridge.extract_events('{"route":"/","status":200')

        self.assertEqual(events, [])
        self.assertEqual(remainder, '{"route":"/","status":200')

    def test_extracts_concatenated_json_objects_without_newlines(self):
        events, remainder = bridge.extract_events(
            '{"route":"/","status":200}{"route":"/dash","status":201}'
        )

        self.assertEqual(
            events,
            [
                {"route": "/", "status": 200},
                {"route": "/dash", "status": 201},
            ],
        )
        self.assertEqual(remainder, "")


class ProcessStreamTests(unittest.TestCase):
    def test_process_stream_reads_multiple_chunks_on_one_connection(self):
        class FakeSocket:
            def __init__(self, chunks):
                self.chunks = list(chunks)

            def recv(self, _size):
                if self.chunks:
                    return self.chunks.pop(0)
                return b""

        sock = FakeSocket(
            [
                b'{"route":"/","status":200}\n{"route":"/login"',
                b',"status":500}\n',
                b'{"route":"/dash","status":201}',
            ]
        )
        seen = []

        bridge.process_stream(sock, seen.append)

        self.assertEqual(
            seen,
            [
                {"route": "/", "status": 200},
                {"route": "/login", "status": 500},
                {"route": "/dash", "status": 201},
            ],
        )


class EventConversionTests(unittest.TestCase):
    def test_timestamp_to_unix_nano_accepts_iso8601_strings(self):
        unix_nano = bridge.timestamp_to_unix_nano("2026-07-24T22:16:38Z")

        self.assertEqual(unix_nano, 1784931398000000000)

    def test_event_to_otlp_converts_live_fuwa_payload_shape(self):
        otlp = bridge.event_to_otlp(
            {
                "timestamp": "2026-07-24T22:16:38Z",
                "service": "fuwa",
                "method": "GET",
                "route": "/",
                "status": 200,
                "duration_ms": 44,
                "error_total": 0,
            },
            "0" * 32,
            "1" * 16,
        )

        span = otlp["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        self.assertEqual(span["startTimeUnixNano"], "1784931398000000000")
        self.assertEqual(span["endTimeUnixNano"], "1784931398044000000")
        self.assertEqual(span["name"], "GET /")


if __name__ == "__main__":
    unittest.main()
