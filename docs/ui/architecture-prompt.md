# Fuwa Architecture — Deep Analysis Prompt

> Paste this entire document into Claude Opus (or any advanced reasoning model)
> to generate a comprehensive, non-redundant Mermaid architecture diagram.

## Instructions

You are a senior systems architect. Analyze the fuwa IDE codebase described below
and produce a **single, unified Mermaid diagram** that captures the complete
architecture at every layer — frontend, template, compiler, runtime, dev server,
and infra. Use Mermaid `graph TD` or `flowchart` syntax with `subgraph` for each
layer. Use `%%` comments to annotate non-obvious relationships.

## Current Repo Corrections

- As of **July 28, 2026**, the live architecture panel consumes **three focused Mermaid tabs** from `shell/hooks/motion.js` (`frontend`, `backend`, `infra`) rather than one monolithic graph in the shell UI.
- The container log SSE helper path is `runtime/openresty/containers_live.lua` (migrated from Python `container_logs.py` to OpenResty/Lua as of July 2026).
- The current dev infra topology is rooted at `/mnt/DATA/development/projects/repos/fuwa-infra-exploration/infra/docker-compose/dev.yml`, which includes `app.dev.yml`, `openresty.yml`, `signoz.yml`, and `telemetry.yml`.
- `/mnt/DATA/development/projects/repos/fuwa-infra-exploration/infra/docker-compose/observability.yml` is an alternate Uptrace-oriented stack, not the default container set wired into `shell/views/fragments/home.fuwa`.
- If you need the panel-ready output instead of the single unified research diagram, treat `shell/hooks/motion.js` as the source of truth for the currently shipped tabbed diagrams.

**Rules:**
- **No redundancy.** If a component appears in multiple layers, show it once and
  connect it with cross-layer edges.
- **Use exact path references.** Every node should reference a real file path
  (e.g., `shell/hooks/editor.js`, `runtime/fuwa-dev.lua`).
- **Show data flow direction.** Use labeled arrows (`-->|compile|`) for request
  flow, response flow, and event flow.
- **Group by concern.** Frontend hooks, template layer, compiler pipeline,
  runtime stdlib, host capabilities, dev server, infra containers.
- **Kaomoji welcome but optional.** Can use them as node labels for personality.
- **Include the observability pipeline.** Show how traces flow from Lua →
  stderr → OpenResty shared dict ring buffer → SSE → browser, and from Wasmoon → postMessage →
  appendEvents → petite-vue.

## Codebase Inventory

### Frontend (Browser) — `shell/hooks/`

| Hook | Role | Key Relationships |
|------|------|-------------------|
| `editor.js` | CodeMirror 6 with Lua highlighting. Emits `fuwa:editor-change`. `pendingEdits` Map. `switchFile()` for client-side navigation. | Reads from `preview.js` on file click, writes changes via `fuwa:editor-change` event |
| `terminal.js` | xterm.js sessions keyed by payload id. Container detached/reparented across HTMX swaps. Deduplicates output by `data-terminal-run-id`. | Mounts on `[data-terminal-root]`. Receives `write()` calls from `preview.js`/`runtime-session.js` |
| `workspace.js` | petite-vue state: popovers (⌘K file palette), grafanaOpen, tmuxOpen, toggle functions with GSAP. Handles ⌘K shortcut, Arrow key nav, search filter, outside-click dismiss. | Mounts petite-vue on `[data-workspace]`. All other hooks reference `FuwaShellWorkspace` |
| `preview.js` | Top-level orchestrator. Creates `FuwaPreviewBrowserDriver`. Listens for `fuwa:editor-change` → `updateCode()`. Client-side file selection from popover. | Depends on `preview-browser.js`, `runtime-session.js`, `editor.js`, `workspace.js` |
| `preview-browser.js` | Creates sandboxed tenant `<iframe>`. `postMessage`-based host↔tenant command relay with ping/ready handshake, ordered queue, request/reply/swap/stream. | Creates `FuwaRuntimeSession` via `runtime-session.js`. Talks to `tenant-runtime.js` via postMessage |
| `runtime-session.js` | Owns Wasmoon Web Worker lifecycle. Seeds in-memory files Map. 650ms live-reload debounce. Routes worker messages to terminal + tenant + observability. | Creates/destroys `runtime-worker.js` Web Worker. Calls `FuwaShellTerminal.write()` and `FuwaShellObservability.appendEvents()` |
| `runtime-worker.js` | Web Worker running Wasmoon (Lua 5.4 in WASM) + SQLite-WASM. Boots engine, installs JS→Lua bridge globals, compiles `.fuwa` in-VM, executes main.lua. | Receives `run` messages from `runtime-session.js`. Posts `html`, `stdout`, `stderr`, `trace` back |
| `tenant-runtime.js` | Inside sandboxed iframe. Replaces `XMLHttpRequest` with `TenantXMLHttpRequest` that routes htmx AJAX through postMessage. Handles `swap`, `clear`, `reply`, `stream` commands. | Receives host commands from `preview-browser.js`. Normalizes paths against `appBasePath` |
| `observability.js` | Diegetic obs console. Ring buffer (max 200 events). SSE connection to `/__dev/traces/live`. Groups events by `trace_id`. `FuwaObservability.log()` as centralized log bus. `FuwaShellObservability.appendEvents()` for Wasmoon traces. | petite-vue reactive state. Receives traces from OpenResty SSE AND from worker via appendEvents. |
| `motion.js` | GSAP animations: darkroom curtain loader, develop-from-black overlay, typewriter header tips (5 cycling tips with typing/holding/deleting phases). | Pure visual. Respects `prefers-reduced-motion` |
| `cursor.js` | Custom loupe cursor: dot + trailing ring, `mix-blend-mode: difference`, expands on interactive elements. | Pure DOM. RAF-driven with lerp smoothing |
| `tmux.js` | Multi-container log viewer. 8 xterm instances. Single multiplexed SSE connection to `/__dev/containers/live?name=...`. Routes structured JSON events to correct terminal by container name. Error-only filtering. | Depends on OpenResty `containers_live.lua` SSE endpoint and Docker |
| `tenant-bridge.js` | Legacy route-backed preview: fetches payload URL, parses HTML, strips+revives scripts, mounts petite-vue+htmx. | Used as fallback when browser runtime not active |

### Frontend Orchestration

- **HTMX 1.9.12**: All server round-trips. `hx-get`, `hx-post`, `hx-target`, `hx-swap` for workspace fragment replacement.
- **petite-vue 0.4.1**: Reactive UI state for popovers, Grafana/tmux toggles, observability request list.
- **Hook lifecycle**: `htmx:beforeSwap` → unmount/detach, `htmx:afterSwap` → remount/reinitialize. Prevents CodeMirror/xterm destruction.
- **CodeMirror 6**: Dynamic import, custom Lua syntax highlighting (Tokyo Night theme via `ViewPlugin` + `Decoration.mark`).
- **xterm.js 6.0.0 + FitAddon**: Terminal sessions detached/reparented across swaps, ResizeObserver for responsive sizing.
- **GSAP 3.15.0**: Curtain loader, Grafana/tmux open/close transitions, typewriter animation.

### Template Layer — `shell/views/`, `shell/pages/`

| File | Role |
|------|------|
| `shell/app.fuwa` | Root module. 3 routes: `GET /` → Home.index, `GET /inspect/:id` → Home.inspect, `POST /switch/:id` → Home.switch |
| `shell/view.fuwa` | Includes `views/layout.fuwa` |
| `shell/views/layout.fuwa` | Full HTML page: all vendor scripts, importmap, ~1300 lines CSS (Tokyo Night theme), grain overlay, loader curtain, main stage |
| `shell/views/home.fuwa` | Includes `views/fragments/home.fuwa` |
| `shell/views/fragments/home.fuwa` | IDE shell: phone preview island (left), editor panel (middle), terminal+obs+tmux+grafana panels (right) |
| `shell/views/fragments/workspace.fuwa` | Workspace chrome: ⌘K file popover with folder headers, breadcrumb nav, editor form |
| `shell/views/fragments/workspace-oob.fuwa` | OOB swap targets for file/status updates |
| `shell/pages/home.fuwa` | Page actions: `index` (full page), `inspect` (fragment + OOB), `switch` (payload switch) |

The `.fuwa` template system: custom HTML-first language with `&path` interpolation, `<include>`, `f-if`, `f-for`, compiled to Lua strings at build time, rendered at runtime via `stdlib/view.lua` which parses HTML into AST → renders against data env.

### Compiler — `runtime/stdlib/compiler/`

| Module | Role |
|--------|------|
| `init.lua` | Entry: `compile_runtime_files()` |
| `modules.lua` | `.fuwa` → `.lua` transpiler |
| `actions.lua` | Action block sugar (guards, result unwrap, render/redirect/fail) |
| `routes.lua` | Route → `web.app()` compilation |
| `view.lua` | View/fragment template compilation, include expansion, `M.render()` generation |
| `package_web.lua` | Top-level `build()`: clones passthrough, compiles `.fuwa`, merges modules, generates `main.lua` |
| `bootstrap.lua` | Generates `main.lua` entry point with `handle_request()` dispatch |
| `imports.lua` | Import parsing |
| `schema.lua` | Schema → model compilation |
| `responses.lua` | Response expression parsing |
| `diagnostics.lua` | Error/warning tracking |
| `strings.lua`, `lines.lua` | Utilities |

Pipeline: `.fuwa` source → `package_web.build()` → compiler transpiles → merged `.lua` modules → `main.lua` → executed by Lua runtime.

### Runtime — `runtime/stdlib/`, `runtime/host/`, `runtime/browser/`

**stdlib/** (generic):
- `web.lua`: HTTP router (`app.dispatch()`, `GET/POST/PUT/DELETE`), middleware chain, `render_response()`
- `view.lua`: SSR template engine — parses HTML to AST, resolves `&bindings`, evaluates `f-if`/`f-for`, renders to string
- `db.lua`: DB provider facade, factory, schema management
- `schema.lua`: Model operations (create, all, find, where, count, update, validate)
- `result.lua`: Ok/Err result type
- `trace.lua`: Span-based tracing with timestamps, context propagation
- `log.lua`: Pretty-printer for tables/errors

**host/** (shell-specific):
- `capabilities.lua`: Host capabilities registry — file I/O, compile, rollback, deployment mount
- `dashboard.lua`: Builds dashboard data structure for template rendering (files grouped by directory, terminal state, preview HTML)
- `bootstrap.lua`: Builds tenant iframe srcdoc scaffolding
- `shell_views.lua`: Runtime `<include>` expansion for fragment rendering

**browser/** (in-browser runtime):
- `init.lua`: Generates `/runtime/tenant.html` — the tenant iframe HTML with phone-shell, petite-vue, htmx, tenant-runtime.js. Builds the `build_runtime_srcdoc()` function.
- Bundle builder: Generates `bundle.json` with compiled sources for the Web Worker

### Dev Server — `nginx.conf`, `runtime/openresty/*.lua`, `runtime/fuwa-dev.lua`

- **`nginx.conf`**: OpenResty (nginx + LuaJIT) router. Routes: `/__dev/traces` → `traces.lua`, `/__dev/traces/live` → `traces_live.lua`, `/__dev/containers/live` → `containers_live.lua`, everything else → `handler.lua` which delegates to `fuwa-dev.lua` in-process. Migrated from Python `dev-server.py` (July 2026).

- **`runtime/openresty/handler.lua`**: Wraps `fuwa-dev.route_request()`. Handles `/__dev/reload` SSE with non-blocking `ngx.sleep()`. Routes all non-SSE requests through `fuwa-dev.lua` in-process (no CGI fork).

- **`runtime/openresty/traces.lua`**: Trace ring buffer (GET/POST) backed by `ngx.shared.DICT`. Replaces Python ring buffer + `__VECTOR__` stderr pipe.

- **`runtime/openresty/traces_live.lua`**: SSE stream polling trace counter every 100ms.

- **`runtime/openresty/containers_live.lua`**: Docker container log SSE multiplexer. Polls `docker logs --tail` per container.

- **`runtime/fuwa-dev.lua`**: Lua request handler. `route_request()` returns `{status, headers, body}`. HTTP parsing, static file serving, payload compilation (`package_web.build`), module loading + dispatch, template rendering, bundle building, DB ops.

### Infra — `fuwa-infra-exploration/infra/docker-compose/`

| Container | Image | Role |
|-----------|-------|------|
| `docker-compose-fuwa-1` | custom | Fuwa dev app |
| `docker-compose-signoz-1` | signoz/signoz | SigNoz frontend dashboard |
| `docker-compose-signoz-ingester-1` | signoz/signoz-otel-collector | OTLP ingest (traces + metrics) |
| `docker-compose-signoz-clickhouse-1` | clickhouse/clickhouse-server | Telemetry storage |
| `docker-compose-signoz-keeper-1` | clickhouse/clickhouse-keeper | ClickHouse coordination |
| `docker-compose-otlp-bridge-1` | custom (Python) | JSON→OTLP bridge (receives from vector, forwards to ingester) |
| `docker-compose-vector-router-1` | timberio/vector | Log/metric aggregation bridge |
| `docker-compose-victoriametrics-1` | victoriametrics/victoria-metrics | Time-series metrics storage |

### Data Flows

**Request flow (full page):**
Browser → OpenResty (nginx) → handler.lua → fuwa-dev.route_request() → package_web.build → load modules → dispatch route → action handler → view.render → HTML → ngx.print() → browser → HTMX + petite-vue + hooks boot

**Live edit flow:**
CodeMirror keystroke → `fuwa:editor-change` → preview.js `updateCode()` → runtime-session.js 650ms debounce → postMessage to Web Worker → Wasmoon compiles + executes → postMessage back → send to tenant iframe → tenant-runtime.js swaps HTML → url rewrite → script revival → petite-vue/htmx re-process

**Observability flow (Lua side):**
fuwa-dev.lua `trace.sink()` → `ngx.shared.traces` ring buffer → SSE fan-out to browser observability.js + (optional) vector POST |

**Observability flow (Wasmoon side):**
runtime-worker.js `__fuwa_trace_sink()` → postMessage `{type:"trace"}` → runtime-session.js → `FuwaShellObservability.appendEvents()` → observability.js ring buffer + POST to /__dev/traces → Python ring buffer

**Container log flow:**
tmux.js single EventSource → `/__dev/containers/live?name=...` → OpenResty containers_live.lua → `docker logs --tail` polling → SSE (ready/status/log/error) → browser routes by container name → xterm instances

### Build System — `Makefile`

| Target | What it does |
|--------|-------------|
| `compile-check` | Parse-check all tracked `.lua` files |
| `lint` | luacheck |
| `test-unit` | Unit tests (compiler, browser, db, host, trace) |
| `test-smoke` | Compiler + shell smoke |
| `test-acceptance` | Full acceptance suites (current_payload, fuwa_gomen, shell_host) |
| `test-integration` | Dev server integration (needs python3) |
| `test` | All of the above, fail-fast, cheapest first |

No traditional build step — Fuwa is interpreted Lua + vanilla JS. `package_web.build()` is invoked at request time (CGI) or in-browser (Wasmoon worker).

## Output Requirements

Produce a **single Mermaid `graph TD` diagram** with these subgraphs:

1. `subgraph Browser["Browser — IDE Shell"]` — all hooks, their relationships, HTMX/petite-vue orchestration
2. `subgraph Tenant["Tenant iframe"]` — tenant-runtime.js, postMessage bridge
3. `subgraph Worker["Web Worker (Wasmoon)"]` — runtime-worker.js, Wasmoon engine, in-VM compiler
4. `subgraph OpenResty["OpenResty"]` — nginx.conf, handler.lua, traces.lua, containers_live.lua, shared dict ring buffer, SSE fan-out, file watcher
5. `subgraph Lua["Lua CGI Handler"]` — fuwa-dev.lua, request dispatch, template rendering
6. `subgraph Compiler["Compiler"]` — package_web, modules, actions, view compiler, bootstrap
7. `subgraph Runtime["Runtime stdlib"]` — web.lua, view.lua, db.lua, trace.lua, schema.lua
8. `subgraph Host["Host capabilities"]` — capabilities.lua, dashboard.lua, bootstrap.lua, shell_views.lua
9. `subgraph Infra["Infra — Docker"]` — all containers, their relationships, data flow

Use labeled edges showing data/event flow direction. Include the observability pipeline (traces) and container log pipeline.
