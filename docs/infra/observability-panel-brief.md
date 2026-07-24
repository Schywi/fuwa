# Observability Panel — Feature Brief

> Written 2026-07-23 for handoff to another agent.  Read this before touching
> any code.

## What was asked for

A third workspace view ("Observability") in the fuwa dev shell, sitting
alongside the existing Code and Terminal views.  The panel should show:

```
+------------------------------------------------------------------+
| [CODE] [OBSERVABILITY]                                [Uptrace ↗] |
+------------------------------------------------------------------+
| PLATFORM HEALTH                                                   |
|  [✓] vector-router (2ms)   [✓] victoriametrics (4ms)   ...       |
+------------------------------------------------------------------+
| LIVE METRICS (Last 5m)                                            |
|      Requests/sec        Error Rate          p95 Latency          |
|      [  12.4  ]          [  0.0%  ]          [  47ms  ]           |
+------------------------------------------------------------------+
| RECENT TRACES (Live Stream)                                       |
|  18:24:01  GET /buy/onigiri      200 OK      47ms                 |
|  18:24:00  GET /poke             200 OK      31ms                 |
|  ...                                                              |
+------------------------------------------------------------------+
|            ( •ω•)ﾉ✧ obs-panel ready · tracking 1.2k events         |
+------------------------------------------------------------------+
```

**Explicitly excluded:** "chaos engineering bullshit" (their words).

The panel should be a **simple APM-like view** with a button to open the real
Uptrace dashboard for deep dives.  No new protocols, no new stores, no new
message types.  Just data flowing through existing channels.

---

## Infrastructure context

A full observability stack is already running in Docker
(`fuwa-infra-exploration/infra/docker-compose/`):

| Service | Port (host) | Role |
|---|---|---|
| **Uptrace** 2.0.2 | `:14317-14318` | APM dashboard (reads ClickHouse) |
| **ClickHouse** 24.12 | `:8123`, `:9000` | Trace/log storage |
| **VictoriaMetrics** 1.102 | `:8428` | Metrics time-series DB |
| **Vector** 0.50 | `:8686-8687` | Pipeline: receives JSON on `:8687`, transforms to metrics + logs |
| **PostgreSQL** 16 | `:5434` | Uptrace metadata (users, projects) |
| **OpenResty** | `:8080` | Front proxy |

The pipeline design:
```
fuwa → POST JSON to Vector:8687
           ↓
Vector splits:  logs → ClickHouse
                metrics (rate/errors/duration) → VictoriaMetrics
           ↓
Uptrace reads ClickHouse + VictoriaMetrics → dashboard
```

Uptrace is seeded with `admin@uptrace.local / uptrace`.
An auto-login OpenResty shim is planned but NOT yet wired
(`docs/infra/uptrace-no-typing-access-plan.md`).

---

## What was implemented

### Architecture overview

```
fuwa-dev.lua                     Python dev-server                   Browser panel
─────────────                    ─────────────────                   ─────────────
dev_trace_sink(event)            stderr pipe reader                  observability.js
  │                                │                                   │
  ├─ pretty → io.stderr ──────────┼─→ sys.stderr (terminal)           │
  │                                │                                   │
  └─ __VECTOR__{json} → stderr ───┼─ parse → ring buffer              │
                                   │    │                               │
                                   │    ├─ POST → Vector:8687          │
                                   │    └─ serve /__dev/traces ────────┼─ poll traces
                                   │                                     │
                                   │  /__dev/proxy/* ───────────────────┼─ poll health
                                   │    → Vector:8686/health             │   & metrics
                                   │    → VictoriaMetrics:8428           │
```

### Files changed

| File | Change |
|---|---|
| `runtime/fuwa-dev.lua` | `dev_trace_sink` writes `__VECTOR__{json}\n` to stderr (line ~240) |
| `runtime/dev-server.py` | Stderr pipe → ring buffer; Vector POST; `/__dev/traces` + `/__dev/proxy/*` API |
| `shell/hooks/observability.js` | Panel component (petite-vue app): health checks, metrics, traces |
| `shell/hooks/workspace.js` | 3-way view toggle: code / terminal / obs |
| `shell/views/fragments/workspace.fuwa` | 3 tab buttons + obs panel HTML |
| `shell/views/layout.fuwa` | Obs panel CSS + script tag |

### Data pipeline (what works)

1. **Lua → stderr:** `dev_trace_sink` JSON-encodes trace events and writes
   `__VECTOR__{json}\n` to `io.stderr`.  2 events per request (span_start +
   request span).  **Verified:** curl test produces 2 `__VECTOR__` lines per
   HTTP request to the Lua process.

2. **Python · stderr reader:** The Python dev server captures stderr lines in
   a background thread.  `__VECTOR__` lines → ring buffer + fire-and-forget
   POST to Vector:8687.  Non-Vector lines → forwarded to terminal.
   **Verified:** unit test captures 2 traces per request.

3. **Python · dev API:** Intercepts `/__dev/traces` and `/__dev/proxy/*`
   routes before forwarding to Lua.
   - `GET /__dev/traces` → ring buffer as JSON
   - `GET /__dev/proxy/vector/health` → `http://127.0.0.1:8686/health`
   - `GET /__dev/proxy/vm/health` → `http://127.0.0.1:8428/health`
   - `GET /__dev/proxy/clickhouse/ping` → `http://127.0.0.1:8123/ping`
   - `GET /__dev/proxy/vm/api/v1/query?query=...` → VictoriaMetrics
   **Verified:** all proxy endpoints return HTTP 200 from running containers.

4. **Frontend · polling:** The observability panel polls every 3 seconds:
   health checks (HTTP 200 → green dot), traces (ring buffer), metrics
   (computed from ring buffer — request count, error rate, p95 latency).

### What does NOT work / known gaps

1. **Python server must be restarted after code changes.**  The `./dev.sh`
   wrapper execs Python.  Code changes to `dev-server.py` require killing
   the process and restarting.  Lua changes (`fuwa-dev.lua`) are picked up
   automatically (spawned per request).  JS/CSS changes require a browser
   hard-refresh (Ctrl+Shift+R).

2. **Metrics are computed client-side from the ring buffer**, not from
   VictoriaMetrics.  The `__VECTOR__` events are trace spans
   (`{kind, name, trace_id, attrs, duration_ms, failed}`), not metric
   counters (`{request_total, error_total}`).  Vector's `log_to_metric`
   transform expects those exact field names, so the trace spans flow to
   ClickHouse as logs but VictoriaMetrics never gets metric data.  The
   panel computes request count, error rate, and p95 latency directly
   from the ring buffer instead.

3. **Vector POST format mismatch.**  The `_post_to_vector` function sends
   the raw trace span JSON.  Vector receives it (HTTP 200 confirmed) and
   routes it to ClickHouse as logs.  But the `vector.toml` transform also
   tries to extract `request_total`, `error_total`, `duration_ms` as
   top-level fields for VictoriaMetrics — these don't exist in our payload.
   If you want VictoriaMetrics-populated metrics, either change the Lua
   output format or add a Vector transform that extracts data from the
   trace span structure.

4. **Uptrace link is hardcoded** to `http://localhost:14318`.  The
   auto-login shim (OpenResty route that auto-POSTs credentials and
   redirects) is NOT implemented.  Clicking Uptrace lands on the login
   page.  See `fuwa-infra-exploration/docs/infra/uptrace-no-typing-access-plan.md`.

5. **No trace filtering or search.**  The panel shows a simple scrollable
   list of recent traces.  No filtering by method/path/status.  No
   expand-to-see-details.

6. **Ring buffer is 200 entries, in-memory only.**  Resets on server
   restart.

---

## Technical constraints discovered during implementation

### `.fuwa` template rules (critical — do not repeat these mistakes)

The `.fuwa` template parser in `runtime/stdlib/view.lua` is NOT a full HTML
parser.  It has specific rules:

1. **`<!-- -->` HTML comments are NOT valid.**  The parser treats every `<`
   as a tag opening.  `<!--` produces `!--` as the tag name, which fails
   the tag-name regex `[%w:_-]+` → "Malformed start tag" error.

2. **`{{ }}` mustache interpolation is NOT valid.**  The `.fuwa` binding
   syntax is `&variable`.  Use `v-text="expr"` for petite-vue text
   interpolation.

3. **`v-if` may not work** — `parse_if_expr` expects `path` or `not path`,
   not arbitrary JS.  Use `v-show` instead.

4. **`f-for` iterates server-side** `.fuwa` data paths like
   `&dashboard.payloads`.  Cannot iterate inline JS arrays like
   `[vector, vm, clickhouse]`.  Use hardcoded elements or `v-for`
   (petite-vue client-side).

### Petite-vue scope isolation

The workspace has `v-scope="FuwaShellWorkspace.createState()"` on the parent
`<div data-workspace>`.  Petite-vue compiles ALL children, including hidden
panels.  If the obs panel uses directives like `v-text="reqCount"`, they are
evaluated against the workspace scope (not the observability scope) →
`ReferenceError`.

**Fix:** `v-pre` on the obs panel container prevents workspace compilation.
The observability app removes `v-pre` and creates its own petite-vue app.
The app instance is reused across view switches (unmount stops polling but
keeps the app alive).

### Python dev server routing

The Python server (`runtime/dev-server.py`) reads the HTTP request line
BEFORE spawning the Lua process.  `/__dev/*` routes are intercepted and
handled directly by Python.  Everything else is forwarded to
`lua5.4 runtime/fuwa-dev.lua`.  This means `/__dev/` routes never spawn a
Lua process — they are pure Python.

### Stderr pipe vs terminal

With `stderr=subprocess.PIPE`, Lua's `io.stderr` output goes to a Python
pipe.  The `_stderr_reader` thread reads the pipe line-by-line, routing
`__VECTOR__` lines to the ring buffer and everything else to `sys.stderr`
(the Python process's actual terminal).

With `stderr=None` (the OLD behavior), stderr goes directly to the terminal
and the ring buffer is never populated.

---

## How to test

1. Start the observability containers:
   ```
   cd fuwa-infra-exploration && docker compose -f infra/docker-compose/dev.yml up -d
   ```

2. Start the dev server:
   ```
   cd fuwa && ./dev.sh
   ```

3. Open the shell, click the OBS tab.

4. Verify:
   - Health dots show green for running containers
   - Trigger a page load → traces appear in the list
   - Metrics update from the ring buffer
   - Uptrace button opens `localhost:14318`

5. If traces don't appear:
   - Check terminal for `__VECTOR__` lines (should NOT appear — they go to ring buffer)
   - Check terminal for pretty-printed traces (should appear)
   - Verify Python server is running latest code: `grep 'stderr=subprocess.PIPE' runtime/dev-server.py`
   - Hard-refresh browser (Ctrl+Shift+R)
