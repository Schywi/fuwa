# Error Handling in the Trace Pipeline

Status: implemented with known gaps. Last updated: 2026-07-24.

## How errors are detected

There are three distinct paths for error detection:

### Path A: `M.span(name, attrs, fn)` — auto-capture (trace.lua:261)

```lua
trace.span("request", {method="GET"}, function(span)
    -- your code here
end)
```

`M.span()` wraps `fn` in `pcall`. On failure, it sets **top-level** fields:
```lua
span.failed = true    -- top-level, NOT in attrs
span.error = results[2]  -- the error message string
```

This is the **only path** that produces `failed: true` at the top level of the close event. It also re-raises the error after closing the span.

### Path B: Manual `span:set("failed", true)` — attrs-only (various callers)

```lua
local span = trace.span("render")
-- ... do work ...
if something_broke then
    span:set("failed", true)   -- goes into attrs.failed, NOT span.failed
end
span:close()
```

**Known gap**: `span:set("failed", true)` stores the value in `self.attrs`, not `self.failed`. When `span:close()` emits the event, it uses `self.failed` (top-level), which is still `false`. The error state is in `event.attrs.failed` but `event.failed` is `false`.

The Wasmoon path (`runtime-worker.js`) uses this manual pattern — it does `req_span:set("failed", true)` and `render_span:set("failed", true)`. These go into attrs but the close event's top-level `failed` remains false.

### Path C: No error detection at all (fuwa-dev.lua:829-832)

```lua
if diagnostics.has_errors(build.diagnostics) then
    request_span:set("status", 500)
    request_span:set("errors", #build.diagnostics)
end
```

Build errors set `status=500` and an error **count** but never set `failed` or `error`. The request event will have `failed: false` and no error message. The UI detects this via `status >= 400` → red tone.

## How errors propagate through the pipeline

```
span:close()
  │
  ├─ event.failed = self.failed    (top-level, trace.lua:196)
  ├─ event.error  = self.error     (top-level, trace.lua:197)
  │
  ▼
emit(event)
  │
  ├─ Server: json.encode → __VECTOR__ on stderr → ring buffer
  └─ Wasmoon: json_encode() → __fuwa_trace_sink → postMessage
       │
       ▼
observability.js  rebuildRequests()
  │
  ├─ event.kind === "request":
  │    req.failed = !!ev.failed       (top-level, line 91)
  │    req.status = Number(ev.status) (line 89)
  │
  ├─ event.kind === "span_end":
  │    Only extracts name, duration_ms, selected attrs for stage summary
  │    ev.failed and ev.error are IGNORED (line 79-83)
  │
  ├─ event.kind === "span_log":
  │    Formatted into text string, pushed to req.logs[]
  │    No special handling for error-related log messages
  │
  ▼
statusTone(req):
    return req.failed || req.status >= 400 ? 'error' : 'ok'
```

## How errors are displayed

### Request row (workspace.fuwa:138)
```html
<button :data-tone="statusTone(request)">
```
- `"error"` tone → red-tinted background (`rgba(244,63,94,0.06)`) + red status code text
- `"ok"` tone → green status code text

### Expanded log (workspace.fuwa:148-152)
```html
<div v-for="line in request.logs" class="obs-log-row" v-text="line"></div>
```
- **All** log entries render identically — no visual difference for error logs
- **The error message (`req.error`) is never displayed**
- `formatEventLine()` omits `failed` and `error` fields entirely

## Known gaps (ordered by impact)

| # | Gap | Where | Impact |
|---|-----|-------|--------|
| 1 | `span:set("failed",true)` → attrs, not top-level `failed` | Wasmoon path (`runtime-worker.js`) | Close events show `failed: false` even when error detected |
| 2 | Error message never displayed | `observability.js` `formatEventLine()` + template | User sees red tone but no "why" |
| 3 | `span_end` `failed`/`error` fields ignored | `observability.js` `rebuildRequests()` line 79-83 | Stage errors are invisible |
| 4 | Compiler diagnostic details lost | `fuwa-dev.lua` line 829-832 | Only error count traced, not individual messages |
| 5 | No `level` field on `span:log()` | `trace.lua` `span:log()` | Can't distinguish error logs from info logs in the pipeline |

## Design rule

**Errors are inline fields + visual highlights, not a separate system.**

- `failed: true` + `error: "message"` on the close event → red request row
- `span:log("DB timeout!", {error: true})` → red log entry in expanded view
- Compiler diagnostics → individual `span_log` events with `fields: {level: "error", file, line, message}`

No external error tracker. No sentry. No separate error pipeline.
