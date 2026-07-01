# Fuwa Runtime — Architecture

The Fuwa runtime is a **full web stack folded into a single browser tab**. There is no
server. A `.fuwa` app is compiled to Lua, executed in a Web Worker, rendered into a
sandboxed iframe, and — critically — its own HTTP requests are caught and looped back
into the in-browser Lua "server." Persistence lands in SQLite-WASM.

The whole design is organized around **three isolation boundaries** plus a build step:

| Boundary | Runs | Trusts |
|---|---|---|
| **Build time** (Vite) | `.fuwa` + hooks bundled into a string map | authoring code only |
| **Main thread** (host) | orchestration, compiler, preview shell | the app author |
| **Web Worker** | Wasmoon Lua VM + SQLite-WASM | nothing from the DOM |
| **Sandboxed iframe** (tenant) | rendered HTML + petite-vue/htmx/UnoCSS | nothing; `allow-scripts allow-forms` |

The two runtime boundaries never touch directly. Everything crosses via `postMessage`
with typed message contracts (`TenantCommand` down, `TenantEvent` up; `WorkerRequest`
in, worker events out).

---

## System diagram

```mermaid
flowchart TB
    subgraph BUILD["🛠 Build time (Vite)"]
        direction LR
        PAYLOAD["payload dir<br/>app.fuwa · pages/*.fuwa<br/>models/*.fuwa · view.fuwa<br/>hooks/*.js → browser.js"]
        RAW["?raw imports<br/>(index.ts)"]
        FILES["RuntimeFiles<br/>Record&lt;string,string&gt;"]
        PAYLOAD --> RAW --> FILES
    end

    subgraph MAIN["🖥 Main thread — SvelteKit host"]
        direction TB
        PIPELINE["pipeline.ts<br/>buildTestPanelPayload()"]
        COMPILER["compiler.ts<br/>.fuwa → Lua<br/>BuildManifest + diagnostics"]
        SESSION["RuntimeSession.ts<br/>state · live-reload · tenant queue"]
        ADAPTER["adapter.ts<br/>RuntimeAdapter"]
        SHELL["PhoneShell.svelte<br/>iframe host + srcdoc"]
        PIPELINE --> COMPILER --> SESSION --> ADAPTER
        SESSION -. TenantCommand .-> SHELL
    end

    subgraph WORKER["⚙️ Web Worker — sandboxed compute"]
        direction TB
        BOOT["boot(): SQLite-WASM first,<br/>then Wasmoon Lua engine"]
        GLOBALS["host globals<br/>set_html · __fuwa_print<br/>__fuwa_vfs_read · __fuwa_db_op"]
        STDLIB["stdlib (BUILTIN_LIBS)<br/>result · schema · web · view · db"]
        LUA["compiled Lua modules<br/>routes · actions · models · view SSR"]
        SQLITE[("SQLite-WASM<br/>persisted rows")]
        BOOT --> GLOBALS --> STDLIB --> LUA
        LUA -->|__fuwa_db_op| SQLITE
    end

    subgraph TENANT["🪟 Sandboxed iframe — the tenant"]
        direction TB
        BRIDGE["runtime-bridge.js<br/>overrides window.XMLHttpRequest"]
        CLIENTLIBS["petite-vue (unpkg)<br/>htmx (/tenant/htmx.min.js)<br/>UnoCSS · GSAP"]
        DOM["rendered #app HTML<br/>v-scope · @click · htmx attrs"]
        BRIDGE --> DOM
        CLIENTLIBS --> DOM
    end

    FILES --> PIPELINE
    ADAPTER -->|postMessage: WorkerRequest| BOOT
    LUA -->|set_html + stdout events| ADAPTER
    SHELL -->|postMessage: swap / reply| BRIDGE
    DOM -->|user action → XHR| BRIDGE
    BRIDGE -->|postMessage: TenantEvent request| SHELL
    SHELL -->|requestFromTenant| SESSION
    SESSION -->|LaunchTarget: request| ADAPTER

    classDef build fill:#2a2a2a,stroke:#888,color:#eee
    classDef main fill:#1e3a5f,stroke:#4a90d9,color:#eee
    classDef worker fill:#3f2a5f,stroke:#a06cd9,color:#eee
    classDef tenant fill:#5f3a1e,stroke:#d99a4a,color:#eee
    class BUILD build
    class MAIN main
    class WORKER worker
    class TENANT tenant
```

---

## The two execution modes

A run is driven by a **`LaunchTarget`**, which has exactly two shapes:

```mermaid
flowchart LR
    subgraph SCRIPT["kind: 'script'"]
        S1["run entryFile"] --> S2["view.lua SSR"] --> S3["set_html → HTML"]
    end
    subgraph REQUEST["kind: 'request'"]
        R1["method + path + body"] --> R2["handle_request()"]
        R2 --> R3["routes (app.fuwa)"]
        R3 --> R4["page action"]
        R4 --> R5["render / redirect / fail"]
    end
```

- **script** — first paint. The entry runs top-to-bottom and emits HTML.
- **request** — every interaction after that. The bridge turns a same-origin XHR into a
  `request` target; `handle_request` dispatches through the routes declared in `app.fuwa`
  to a page action, which returns a `render`/`redirect`/`fail` response.

---

## The persistence loop (why XHR, not fetch)

This is the single most important flow in the system — a browser tab talking HTTP to
itself:

```mermaid
sequenceDiagram
    participant U as User (tenant DOM)
    participant B as runtime-bridge.js
    participant H as Host (PhoneShell → RuntimeSession)
    participant W as Worker (Lua)
    participant D as SQLite-WASM

    U->>B: @click feed('onigiri') → XHR GET /buy/onigiri
    Note over B: window.XMLHttpRequest is shimmed
    B->>H: postMessage TenantEvent{request, path, body}
    H->>W: LaunchTarget{kind:'request'}
    W->>W: handle_request → route → action
    W->>D: model change → db.lua → __fuwa_db_op
    D-->>W: committed row
    W-->>H: render() HTML (reply)
    H-->>B: postMessage TenantCommand{reply, html}
    B-->>U: swap DOM · htmx.process · petite-vue re-scope
```

Mutations **must** use `XMLHttpRequest`, because the bridge only shims `XMLHttpRequest`
— a raw `fetch()` escapes the tenant and never reaches the Lua DB. (This is the bug fixed
in commit `fix(fuwa-gomen): persist via XHR so mutations hit the Lua DB`.)

---

## Where the three client libraries actually live

petite-vue, htmx, and UnoCSS are **not** bundled into the host app. They are injected
into the tenant iframe's `srcdoc` and only exist inside that sandbox:

- **petite-vue** — `v-scope` / `@click` reactive bindings, loaded from unpkg
- **htmx** — declarative request attributes, served locally at `/testpanel/tenant/htmx.min.js`
- **UnoCSS** — atomic classes generated at runtime
- **GSAP** — injected onto `window.gsap` by the bridge for effects

The host only knows how to render a string of HTML and shuttle messages. The reactive
layer belongs entirely to the DSL-authored app.

---

## File map

| Path | Role |
|---|---|
| `engine/compiler.ts` | `.fuwa` → Lua transpiler, manifest, diagnostics |
| `engine/RuntimeSession.ts` | main-thread orchestrator + state store |
| `engine/adapter.ts` · `worker.ts` | Web Worker boot + message protocol |
| `engine/sqlite.ts` | SQLite-WASM init + `__fuwa_db_op` |
| `engine/stdlib/*.lua` | `result` · `schema` · `web` · `view` · `db` runtime |
| `ui/engine/PhoneShell.svelte` | iframe host, `srcdoc`, `postMessage` plumbing |
| `ui/engine/runtime-bridge.js` | in-tenant XHR shim + DOM processing |
| `payloads/*/` | `.fuwa` sources + hooks assembled into `RuntimeFiles` |
