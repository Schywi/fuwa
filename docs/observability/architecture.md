# Observability Architecture

Status: implemented. Last updated: 2026-07-24.

## The three things and what they mean here

| Term | What it answers | In fuwa |
|------|----------------|---------|
| **Trace** | "What happened in this request?" — a span tree with durations, parent-child relationships, and attributes. | `runtime/trace.lua` — full OpenTelemetry-inspired span system. Server path (`fuwa-dev.lua`) and Wasmoon path (`runtime-worker.js`) both instrumented. |
| **Log** | "What detail was recorded?" — a message with fields, attached to a span via `span:log()`. | Events of kind `"span_log"` flowing through the same `trace_id`-based pipeline. Grouped into `request.logs[]` in the UI. |
| **Error highlight** | "Something broke — show me why." — not a separate system. Just a `span_log` with `tone: "error"` plus the `failed` + `error` fields on the closing event. | Rendered with red background in the expanded log. The request row gets `data-tone="error"` styling. |

**Metrics** (counters, gauges, histograms, p95, error rate) are explicitly NOT implemented. They're client-side computations on the ring buffer — not first-class infrastructure. If needed, compute them from traces. See `docs/infra/observability-panel-brief.md` for the reasoning.

## Two-trace pipeline

```
                    ┌─────────────────────────────────┐
                    │        SERVER PATH               │
                    │                                  │
HTTP request ──────►│ fuwa-dev.lua                     │
                    │   trace.span("request")          │
                    │   trace.span("compile")          │
                    │   trace.span("render")           │
                    │   span:log("scanning", {files})  │
                    │        │                         │
                    │   io.stderr:write("__VECTOR__"   │
                    │     .. json)                     │
                    │        │                         │
                    │        ▼                         │
                    │   dev-server.py                  │
                    │   ring buffer → /__dev/traces    │
                    │   SSE → /__dev/traces/live       │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────┴──────────────────┐
                    │       observability.js           │
                    │                                  │
                    │   rawEvents[] (shared buffer)    │
                    │   rebuildRequests()              │
                    │   group by trace_id              │
                    │   sort by _ts                    │
                    │   state.requests → PetiteVue     │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────┴──────────────────┐
                    │        WASMOON PATH              │
                    │                                  │
iframe button ─────►│ runtime-worker.js                │
                    │   trace.span("request")          │
                    │   trace.span("render")           │
                    │   span:log(...)                  │
                    │        │                         │
                    │   json_encode() in Lua           │
                    │   __fuwa_trace_sink(json_str)    │
                    │        │                         │
                    │   postMessage({type:'trace'})    │
                    │        │                         │
                    │        ▼                         │
                    │   runtime-session.js             │
                    │   FuwaShellObservability         │
                    │     .appendEvents()              │
                    │        │                         │
                    │   POST /__dev/traces             │
                    │   (persists to server ring buf)  │
                    └──────────────────────────────────┘
```

Both paths use the same event schema (`kind`, `trace_id`, `span_id`, `name`, `attrs`, `duration_ms`). The transport differs (SSE for server, postMessage for Wasmoon) but the UI consumes them identically.

## The Sentry question

Sentry is **always-on breadcrumbs + error-triggered flush.** Logs are recorded in a local ring buffer (cheap). They're only sent to the backend when an error is detected. Normal request logs are overwritten.

fuwa doesn't need this because:
- fuwa is a **dev tool**, not a production service. You WANT full history.
- The ring buffer already caps at 200 events per process — cost is bounded.
- Error highlights (red styling on `req.failed` + error `span_log` events) give you the same signal without a separate flush mechanism.

If we ever need production-style error sampling, the architecture supports it: add a `level` field to `span:log()`, and only forward `level="error"` events through the POST to `/__dev/traces`. The ring buffer always keeps everything.

## Key design decisions

1. **One event schema, two transports.** Server traces go through `io.stderr` → Python ring buffer → SSE. Wasmoon traces go through `postMessage` → session → `appendEvents()` → POST to ring buffer. Both produce identical JSON events.

2. **Logs are span children, not standalone entities.** There is no `log.info()` or `log.error()`. Every log is attached to a span via `span:log(message, fields)`. This means every log has a `trace_id` and `span_id` — traceability is automatic.

3. **Errors are inline fields, not separate events.** There is no `kind: "error"`. Errors travel as `failed: true` + `error: "message"` on `span_end` and `request` events. Error-specific `span_log` events use `tone: "error"` for visual highlighting.

4. **JSON in Lua, not in JS.** Trace events are JSON-encoded on the Lua side to avoid Wasmoon proxy marshalling issues. The JS side receives plain strings.

5. **PetiteVue reactivity requires the proxy, not the raw object.** After `createApp(state)`, replace `state` with `PetiteVue.reactive(state)`. Mutations on the raw object bypass the Proxy set trap.

## File ownership

| File | Responsibility |
|------|---------------|
| `runtime/trace.lua` | Span creation, log attachment (`span:log()`), event emission |
| `runtime/log.lua` | Pretty-printing for terminal output, serialization helpers |
| `runtime/fuwa-dev.lua` | Server-side trace sink (`dev_trace_sink`), `__VECTOR__` stderr pipe |
| `runtime/dev-server.py` | Ring buffer, `/__dev/traces` GET/POST/SSE, stderr reader |
| `runtime-worker.js` | Wasmoon trace sink, Lua-side JSON encoder, postMessage bridge |
| `runtime-session.js` | Host-side worker message handler, `trace` → `appendEvents()` relay |
| `observability.js` | Event aggregation (`rebuildRequests()`), PetiteVue state, UI rendering |
| `workspace.fuwa` | Template: request rows, expanded log area |
| `layout.fuwa` | CSS: row styles, log entry styles (by `data-kind`) |

## Related docs

- `docs/infra/observability-panel-brief.md` — original brief, describes the "diegetic console" philosophy
- `docs/observability/trace-log-model.md` — data model: event schema, span lifecycle, request aggregation
- `docs/observability/error-handling.md` — how errors are detected, propagated, and displayed
