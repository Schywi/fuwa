  # Fuwa Runtime — Public Shell

  > **Notice:** This is a refactor from the real Svelte-based app to `.fuwa`
  only.
  > The production platform (SvelteKit shell, deploy/sync infra, tenant backend)
  is private.
  > What you're looking at is the `.fuwa` application layer, rebuilt to stand on
  its own.

  <img src="docs/images/fuwakoto-explore-blank-cover.png" alt="Fuwa runtime cover" width="100%">

  ## What this is

  A `.fuwa`-authored app runs entirely from files like `app.fuwa`,
  `pages/*.fuwa`,
  and `models/*.fuwa` — no Svelte components, no SvelteKit routing, no server
  framework.
  The DSL compiles to Lua, executes in-browser via a Wasmoon Web Worker,
  persists state
  through SQLite-WASM, and renders through a lightweight client stack:

  - **petite-vue** — reactive bindings on the rendered HTML
  - **htmx** — request wiring (mutations flow back into the Lua runtime, not a
  server)
  - **UnoCSS** — atomic styling, generated on the fly
  - **Lua** — main language

  None of these three are compiled into the host app. They're runtime
  dependencies of
  the *tenant* — the sandboxed preview shell the compiled `.fuwa` app runs
  inside.

  ## Architecture

  The runtime folds a full web stack into a single browser tab across three
  isolation boundaries — main thread, Web Worker (Lua + SQLite-WASM), and a
  sandboxed tenant iframe — that talk only over typed `postMessage` contracts.

  See **[docs/architecture.md](docs/architecture.md)** for the full breakdown,
  including system, execution-mode, and persistence-loop diagrams.

  ```mermaid
  flowchart LR
      FUWA[".fuwa source"] --> COMPILER["compiler<br/>→ Lua"]
      COMPILER --> WORKER["Web Worker<br/>Wasmoon + SQLite-WASM"]
      WORKER -->|set_html| SHELL["PhoneShell<br/>iframe host"]
      SHELL -->|postMessage| TENANT["tenant iframe<br/>petite-vue · htmx · UnoCSS"]
      TENANT -->|XHR → request| SHELL
      SHELL --> WORKER
  ```

  ## Why

  The original platform proves the `.fuwa → Lua` pipeline works. This shell
  proves it
  works *without* a hand-authored Svelte fallback propping it up — every
  interactive surface here (state, forms, mutations, styling) is DSL-authored and
  DSL-driven, right down to the reactivity layer.

  ## Structure

      app.fuwa          # root app / route declarations
      pages/*.fuwa       # page definitions
      models/*.fuwa      # schema-backed state (e.g. wallet, mood, ledger)
      view.fuwa          # template output
      hooks/*.js         # bootstrap, style, fx — glue injected around the
  compiled Lua

  ## What's intentionally not here

  - The SvelteKit host shell, mobile gesture layer, and editor UI
  - Deploy/sync/public-preview worker infrastructure
  - Any tenant billing, auth, or private content pipeline

  This repo is the DSL surface only.

  ## Status

  Experimental / actively refactored. Expect churn between example payloads as
  the
  `.fuwa` → petite-vue/htmx/UnoCSS pattern gets settled.
