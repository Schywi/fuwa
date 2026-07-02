# Step 3: Browser Runtime

Goal: add the browser execution substrate that the IDE ultimately needs, while
keeping the shell contract stable.

Why this step exists:

- the user requirement is browser-based authoring, not only server-backed Lua
- the public README already describes the north-star worker architecture
- current shell and tenant routing prove the host/tenant model, but they do not
  yet prove in-browser execution

This step is the actual Wasmoon phase.

Contract to preserve:

- shell remains the top-level app at `/`
- shell still calls `host.mount_payload("preview", payload_id)`
- shell CSS/layout stays as intact as possible
- compiler stays unaware of host privilege

What changes underneath:

- route-backed tenant documents stop being the only mount substrate
- host mount returns or resolves a browser runtime bootstrap instead
- tenant requests are handled by a worker-owned runtime loop rather than only by
  the dev server request path

Recommended runtime topology:

```text
main thread
  |- shell document
  |- phone shell UI
  |- iframe element
  |- thin courier only

iframe bootstrap document
  |- loads host-provided tenant bootstrap
  |- owns the tenant DOM boundary

worker
  |- Wasmoon Lua VM
  |- SQLite-WASM
  |- compile/request loop
```

Implementation tasks:

1. Define the worker bootstrap contract.
   Minimum messages:
   - `boot`
   - `load_payload`
   - `handle_request`
   - `set_html`
   - `log_event`
   - `fatal`

2. Define the tenant bootstrap document.
   This can use `srcdoc` later, but only after the base-path semantics are
   deliberate. It should:
   - load tenant bridge JS
   - connect iframe document to worker message flow
   - mount returned HTML into a stable root

3. Port the compile/request loop into browser-worker form.
   Reuse current compiler/runtime pieces where possible:
   - [runtime/stdlib/compiler](/mnt/DATA/development/projects/repos/fuwa/runtime/stdlib/compiler)
   - [runtime/stdlib/view.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/stdlib/view.lua:1)
   - [runtime/db](/mnt/DATA/development/projects/repos/fuwa/runtime/db)

4. Add provider strategy for browser persistence.
   - local dev baseline already uses `sqlite_local`
   - browser runtime needs `sqlite_wasm`
   - provider contract must stay consistent with current `runtime.db`

5. Keep server-backed mode as fallback during rollout.
   The browser runtime should land behind a mode switch first, so the current
   route-backed shell proof remains available while the worker path stabilizes.

6. Add telemetry at the new seams.
   Spans for:
   - worker boot
   - payload load
   - request dispatch
   - HTML update
   - db provider calls

Acceptance criteria:

- shell still renders unchanged at `/`
- mounting a payload can target browser-worker mode without changing shell view
- tenant interactions work in-browser through the worker substrate
- browser persistence uses the same runtime DB contract as server mode

ASCII:

```text
shell/.fuwa
    |
    | host.mount_payload("preview", "current")
    v
iframe bootstrap
    |
    v
worker (Wasmoon + SQLite-WASM)
    |
    v
tenant compiled from payloads/current
```
