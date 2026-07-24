# Trace & Log Data Model

Status: implemented. Last updated: 2026-07-24.

## Event schema

Every event flowing through the pipeline has this base shape:

```json
{
  "kind": "span_start|span_log|span_end|request",
  "name": "compile",
  "trace_id": "trace_6a62e550_1",
  "span_id": "span_6a62e550_5",
  "parent_id": "span_6a62e550_1",
  "depth": 0,
  "_ts": 1721788800.123
}
```

### `span_start` — span begins

```json
{
  "kind": "span_start",
  "name": "compile",
  "trace_id": "trace_6a62e550_1",
  "span_id": "span_6a62e550_5",
  "parent_id": "span_6a62e550_1",
  "depth": 1,
  "attrs": {"files": 19},
  "_ts": 1721788800.0
}
```

`attrs` carries the initial attributes passed to `trace.span(name, attrs)`.

### `span_log` — log attached to span

```json
{
  "kind": "span_log",
  "name": "compile",
  "trace_id": "trace_6a62e550_1",
  "span_id": "span_6a62e550_5",
  "parent_id": "span_6a62e550_1",
  "depth": 1,
  "message": "scanning source",
  "fields": {"files": 19},
  "_ts": 1721788800.123
}
```

Called via `span:log(message, fields)`. Carries a human-readable `message` and structured `fields`. The `tone` field (not part of the event schema) is derived by `formatEventLine()` from `fields.error` or message content.

### `span_end` — span ends

```json
{
  "kind": "span_end",
  "name": "compile",
  "trace_id": "trace_6a62e550_1",
  "span_id": "span_6a62e550_5",
  "parent_id": "span_6a62e550_1",
  "depth": 1,
  "attrs": {"files": 19, "modules": 3},
  "duration_ms": 42.1,
  "failed": false,
  "error": null,
  "_ts": 1721788801.500
}
```

`attrs` here is the accumulated state — all `span:set(key, value)` calls plus the initial attrs merged together.

### `request` — request span ends (kind becomes "request")

```json
{
  "kind": "request",
  "name": "request",
  "trace_id": "trace_6a62e550_1",
  "span_id": "span_6a62e550_1",
  "parent_id": null,
  "depth": 0,
  "attrs": {"method": "GET", "path": "/calm", "status": 200},
  "method": "GET",
  "path": "/calm",
  "status": 200,
  "duration_ms": 86.1,
  "failed": false,
  "error": null,
  "_ts": 1721788803.0
}
```

When a span named `"request"` closes, `kind` becomes `"request"` instead of `"span_end"`. Additionally, `method`, `path`, `status` are promoted from attrs to top-level fields for convenience.

## Request aggregation (`rebuildRequests()`)

`rebuildRequests()` in `observability.js` transforms the flat event stream into structured request objects:

```
rawEvents[]   (flat array of events)
  │
  ├─ Group by trace_id → byTrace[trace_id] = { logs[], stages[], ... }
  │
  ├─ For each event:
  │   ├─ Push formatted label into logs[] (all event kinds)
  │   ├─ kind="span_start" name="request" → set method, path
  │   ├─ kind="span_end" → push {name, duration, detail} into stages[]
  │   └─ kind="request" → finalize: set status, duration, failed
  │
  └─ Filter: only finalized requests (kind="request" seen)
     Sort by _ts (newest first)
     Cap at 50

Result: state.requests[] = [
  {
    traceId: "trace_6a62e550_1",
    method: "GET",
    path: "/calm",
    status: 200,
    statusLabel: "200",
    durationMs: 86.1,
    durationLabel: "86ms",
    failed: false,
    stageSummary: "compile 42ms · render 28ms",
    stages: [
      { name: "compile", duration: "42ms", detail: "files=19 modules=3" },
      { name: "render",  duration: "28ms", detail: "bytes=21572" }
    ],
    logs: [
      { kind: "span_start", label: "▶ request  method=GET path=/calm", ts: 1721788800.0 },
      { kind: "span_start", label: "  ▶ compile  files=19",            ts: 1721788800.0 },
      { kind: "span_log",   label: "  · scanning source  files=19",   ts: 1721788800.123 },
      { kind: "span_log",   label: "  · emitted modules  count=3",    ts: 1721788800.456 },
      { kind: "span_end",   label: "  ◀ compile  files=19 modules=3  42ms", ts: 1721788801.500 },
      { kind: "span_start", label: "  ▶ render  method=GET path=/calm", ts: 1721788801.501 },
      { kind: "span_end",   label: "  ◀ render  bytes=21572  28ms",   ts: 1721788801.530 },
      { kind: "request",    label: "◀ request  GET /calm  status=200  86ms", ts: 1721788803.0 }
    ]
  }
]
```

Each `log` entry is an object with `kind`, `label` (formatted display string), `ts` (timestamp for sorting), and optionally `tone` ("error" for red highlight).

## Span lifecycle

```
trace.span("compile", {files: 19})
  │
  ├─► emit({kind:"span_start", name:"compile", attrs:{files:19}})
  │
  ├─► span:log("scanning", {files: 19})
  │     └─► emit({kind:"span_log", name:"compile", message:"scanning", fields:{files:19}})
  │
  ├─► span:log(target, "emitted", {count: 3})
  │     └─► emit({kind:"span_log", name:"compile", message:"emitted", fields:{count:3}})
  │
  ├─► span:set("modules", 3)
  │     └─► self.attrs.modules = 3  (emitted only at close)
  │
  └─► span:close()
        └─► emit({kind:"span_end", name:"compile", attrs:{files:19, modules:3}, duration_ms:42.1})
```

`span:log()` emits immediately. `span:set()` is batched — emitted only at close. Both carry the span's `trace_id` and `span_id` for correlation.

## Timestamps (`_ts`)

Injected at ingestion time, NOT at emission time:

- **Server path**: `dev-server.py` `add_trace()` injects `time.time()` (float seconds since epoch)
- **Wasmoon path**: `runtime-worker.js` `__fuwa_trace_sink` injects `Date.now() / 1000`

This means timestamps reflect when the event was **received by the observability pipeline**, not when the span was created/closed in Lua. For sorting purposes (relative ordering within a single process), this is sufficient. For cross-process correlation, a monotonic clock on the Lua side would be better.

`_ts` is used by `rebuildRequests()` for sorting (newest first). Each `request.logs[]` entry carries the timestamp for display in the expanded view.

## Transport

### Server → browser (SSE)
```
event: trace
data: {"kind":"span_start","name":"request",...}

event: trace
data: {"kind":"span_log","message":"scanning",...}
```

SSE endpoint: `GET /__dev/traces/live`

### Wasmoon → host (postMessage)
```js
post({ type: 'trace', events: ['{"kind":"span_start",...}', '{"kind":"span_log",...}'] })
```

Host receives via `runtime-session.js` → `FuwaShellObservability.appendEvents()`

### Browser → server (persistence)
```js
fetch('/__dev/traces', {
  method: 'POST',
  body: JSON.stringify({ events: [{kind:"span_start",...}, ...] })
})
```

POST endpoint: `POST /__dev/traces` — ingests into ring buffer so traces survive page refresh.
