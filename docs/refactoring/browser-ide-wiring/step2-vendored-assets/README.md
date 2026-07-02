# Step 2: Vendored Assets

Goal: stop depending on ad hoc CDN loading for critical host/runtime
dependencies and define one explicit asset model for the browser IDE.

Why this step exists:

- shell and payload layouts currently load `htmx` and `petite-vue` from unpkg:
  - [shell/views/layout.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/layout.fuwa:8)
  - [payloads/current/views/layout.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/views/layout.fuwa:8)
- there is no current `vendor/` or `static/` tree in the repo
- upcoming browser IDE work needs pinned delivery for:
  - Wasmoon
  - SQLite-WASM assets
  - CodeMirror
  - xterm
  - htmx
  - petite-vue

Decision:

- use committed repo assets for runtime-critical dependencies
- prefer `/vendor/` or `/static/` served by `runtime/fuwa-dev.lua`
- do not introduce npm as the runtime distribution path
- CDN can remain a short-lived fallback during transition, but not the target

Recommended asset structure:

```text
vendor/
  htmx/
    htmx-1.9.12.min.js
  petite-vue/
    petite-vue-0.4.1.js
  codemirror/
    ...
  xterm/
    ...
  wasmoon/
    ...
  sqlite-wasm/
    ...
```

Implementation tasks:

1. Choose one canonical static root.
   - either `vendor/`
   - or `static/vendor/`
   Pick one and use it for all host and tenant dependencies.

2. Extend `runtime/fuwa-dev.lua` static asset serving for that root.
   The file already serves shell and payload assets:
   - [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:307)
   - [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:817)
   - [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:837)

3. Move current CDN dependencies first.
   - htmx
   - petite-vue
   This proves the asset path before adding larger libraries.

4. Add future browser IDE dependencies in pinned form.
   - Wasmoon files
   - SQLite-WASM files
   - CodeMirror core plus minimal extension set
   - xterm core plus required addon set only

5. Keep asset loading intentionally thin.
   - no bundler manifest
   - no npm install contract for runtime delivery
   - no dynamic version resolution at runtime

Acceptance criteria:

- shell and payload load htmx/petite-vue from local pinned assets
- dev server can serve vendored JS/CSS/WASM assets directly
- future Wasmoon/CodeMirror/xterm work has a stable asset path to target

ASCII:

```text
shell/.fuwa
  -> /vendor/htmx/...
  -> /vendor/petite-vue/...
  -> /vendor/codemirror/...
  -> /vendor/xterm/...

payload/.fuwa
  -> same vendor root

runtime/fuwa-dev.lua
  -> serves pinned repo assets
```
