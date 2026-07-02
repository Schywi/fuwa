# Browser IDE Wiring Plan

Status: execution plan. This plan starts from the current `fuwa` repo state,
not from the old `/IDE` assumptions.

This folder exists because the refactoring notes were getting flat and hard to
scan. The steps below are ordered, grounded in the current code, and grouped by
the next real problem: moving from a working route-backed shell proof to a
browser IDE substrate with editor, terminal, and tenant runtime wiring.

Current confirmed baseline:

- shell is served at `/` by [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:1)
- payloads are served at `/payload/:id/`
- `host.mount_payload(...)` returns a route-backed iframe in
  [runtime/host/capabilities.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua:133)
- shell fragment rendering is already split through
  [runtime/host/shell_views.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/shell_views.lua:46)
- payload HTMX routes are absolute, for example
  [payloads/current/views/fragments/counter.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/views/fragments/counter.fuwa:9)
- recent commits already landed the shell proof:
  - `ff70652` split shell fragment render path
  - `b736161` mount payloads as route-backed tenant documents
  - `b88b2e0` commit remaining workspace changes

What is still missing:

- the browser worker substrate described in the README is not implemented yet
- there is no Wasmoon worker runtime in the public repo today
- there is no vendored asset strategy for CodeMirror or xterm yet
- shell host hooks are still minimal
- the IDE surfaces are proof-level, not a usable browser IDE yet

Execution order:

1. [Step 1](step1-baseline-and-contracts/README.md): freeze the current
   server-backed shell baseline and make the contracts explicit
2. [Step 2](step2-vendored-assets/README.md): remove CDN/npm ambiguity and
   define the asset loading model for host widgets and browser runtime files
3. [Step 3](step3-browser-runtime/README.md): add the Wasmoon worker substrate
   without breaking the shell contract
4. [Step 4](step4-host-widgets/README.md): mount CodeMirror and xterm through
   narrow shell hooks
5. [Step 5](step5-ide-surfaces/README.md): wire ugly-but-real IDE surfaces on
   top of the proven substrate

Non-goals for this plan:

- no mobile port
- no UI polish pass
- no compiler awareness of host privilege
- no reintroduction of Svelte/Vite/npm as the runtime dependency path
