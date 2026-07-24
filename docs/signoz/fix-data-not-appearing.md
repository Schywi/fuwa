# SigNoz — Why Live Data Wasn't Appearing

Date: 2026-07-24

## What was actually broken

The original diagnosis was wrong.

- `signoz_traces.signoz_spans = 0` was **not** proof that SigNoz ingestion was broken.
- On the current SigNoz schema, live trace rows are written to tables such as
  `signoz_index_v3` and `trace_summary`.
- The real failure was earlier in the pipeline: live `fuwa` request telemetry
  reached `vector-router`, but `otlp-bridge` dropped it before it could become
  OTLP spans.

## Real root cause

There were two bridge bugs in `infra/docker-compose/otlp-bridge.py`:

1. The TCP server treated Vector's socket stream like a one-shot packet.
   It accepted a connection, performed a single `recv`, and closed the socket.
   Vector kept the connection open and sent multiple events, so this caused:
   - `Received EOF from the server, shutdown.`
   - `Error sending data.`
   - `Events dropped`

2. The bridge only handled its own synthetic seed payload shape.
   - Seed traces use an integer nanosecond `timestamp`.
   - Real `fuwa` events use an ISO-8601 string timestamp such as
     `2026-07-24T22:16:38Z`.
   - `event_to_otlp(...)` assumed it could add an integer duration directly to
     `timestamp`, so live events crashed with:
     - `can only concatenate str (not "int") to str`

## How to verify the real problem

### Vector showed dropped live events

```bash
docker compose -f infra/docker-compose/dev.yml logs vector-router --since 5m
```

Look for:

```text
Received EOF from the server, shutdown.
Error sending data.
Events dropped
```

### The bridge crashed on live `fuwa` payloads

```bash
docker compose -f infra/docker-compose/dev.yml logs otlp-bridge --tail 50
```

Look for:

```text
err: can only concatenate str (not "int") to str
```

### SigNoz was already storing traces in the current tables

```bash
docker exec docker-compose-signoz-clickhouse-1 clickhouse-client -q "
SELECT count(), max(timestamp) FROM signoz_traces.signoz_index_v3
"
```

This is the correct proof table for current live traces, not `signoz_spans`.

## Fix

`infra/docker-compose/otlp-bridge.py` now:

- keeps reading from the TCP connection until the peer closes it
- parses newline-delimited and concatenated JSON frames safely across chunk
  boundaries
- converts ISO-8601 timestamps from real `fuwa` events into OTLP nanoseconds
- resolves the OTLP target lazily instead of doing DNS work at import time

Regression coverage lives in:

- [tests/unit/otlp_bridge_test.py](/mnt/DATA/development/projects/repos/fuwa-infra-exploration/tests/unit/otlp_bridge_test.py:1)

## Verified result

After rebuilding `otlp-bridge` and sending fresh requests through
`http://localhost:8080/`:

- `signoz_traces.signoz_index_v3` advanced from `801` to `806`
- `signoz_traces.trace_summary` advanced from `500` to `505`
- the latest trace timestamp advanced to `2026-07-24 22:17:52 UTC`

That confirms live `fuwa` requests are reaching SigNoz again.
