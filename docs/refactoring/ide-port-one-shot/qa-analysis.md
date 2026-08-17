# QA Analysis: Current `fuwa` Versus Real `/IDE`

Status: verified against the current repos on 2026-07-04.

This is not a generic opinion. It is grounded in the current code and test
results from:

- `/mnt/DATA/development/projects/repos/fuwa`
- `/mnt/DATA/development/projects/repos/IDE`

## Executive Summary

The current `fuwa` repo has passed the **shell proof** stage but has **not**
completed the real desktop IDE port.

What is genuinely implemented today:

- a `.fuwa` shell served at `/`
- payloads served at `/payload/:id/`
- route-backed iframe preview mounting through `host.mount_payload(...)`
- vendored `htmx`, `petite-vue`, `CodeMirror`, `xterm`, `UnoCSS`, `GSAP`
- shell-level editor and terminal widget mounts
- a compile-on-save shell loop

What is still missing or incomplete:

- real browser worker runtime parity with `/IDE`
- Wasmoon + SQLite-WASM execution path in the public repo
- runtime bridge / command queue parity with `/IDE`
- pixel-accurate desktop IDE layout parity
- file search popover
- file list dropdown
- runtime-session orchestration
- non-destructive preview refresh behavior
- reliable save/reload behavior

Bluntly: **phase 9 and 10 are not complete**. The public shell is still a
hybrid proof, not yet a faithful Lua/.fuwa port of the desktop Svelte IDE.

## Current Repo State

Recent `fuwa` commits show real progress:

- `3541d7e` vendored browser IDE assets locally
- `491b0fa` scaffolded browser IDE assets and widgets
- `2fd2e06` mounted shell editor and terminal widgets
- `95e93e1` added shell save/run loop tests
- `8465bf6` saved payload edits

Those are real changes. This is not a blank repo anymore.

## Verified Working Pieces

### 1. Shell routing and route-backed payload mounting

Implemented in:

- [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:860)
- [runtime/host/capabilities.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua:133)
- [runtime/host/shell_views.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/shell_views.lua:46)

This means:

- shell is primary at `/`
- payloads have their own tenant routes
- `host.mount_payload(...)` returns route-backed iframe HTML

That part is real.

### 2. Local vendor assets are now in place

Vendor tree exists:

- [vendor/htmx](/mnt/DATA/development/projects/repos/fuwa/vendor/htmx)
- [vendor/petite-vue](/mnt/DATA/development/projects/repos/fuwa/vendor/petite-vue)
- [vendor/codemirror](/mnt/DATA/development/projects/repos/fuwa/vendor/codemirror)
- [vendor/xterm](/mnt/DATA/development/projects/repos/fuwa/vendor/xterm)
- [vendor/unocss](/mnt/DATA/development/projects/repos/fuwa/vendor/unocss)
- [vendor/gsap](/mnt/DATA/development/projects/repos/fuwa/vendor/gsap)

So the repo is no longer depending on CDN for the core shell/payload stack.

### 3. Shell editor and terminal widget mounts exist

Implemented in:

- [shell/hooks/editor.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/editor.js:1)
- [shell/hooks/terminal.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/terminal.js:1)
- [shell/views/fragments/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa:97)

This means:

- CodeMirror mount exists
- xterm mount exists
- widget remount after HTMX swap is implemented

But this is still shallow compared to `/IDE`.

## Verified Broken / Regressed

### High: current payload route is broken by a syntax regression

`GET /payload/current/` currently fails in the test suite because:

- [payloads/current/pages/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/pages/home.fuwa:33)

has:

```fuwa
}, "\")
```

That leaves the generated Lua with an unfinished string.

Observed failures:

- `lua5.4 tests/acceptance.lua`
- `lua5.4 tests/dev_server_smoke.lua`

Both fail with:

```text
pages.home:93: unfinished string near '"")'
```

This is a real regression, not a hypothetical one.

### High: file inspect and save still replace too much of the shell

Current shell behavior:

- file click targets `#shell-content`
- save targets `#shell-content`

See:

- [shell/views/fragments/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa:89)
- [shell/views/fragments/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa:99)

And that shell fragment also includes:

- `&unsafe dashboard.preview_html`

at:

- [shell/views/fragments/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa:72)

Result:

- clicking a file swaps the whole shell fragment
- the preview iframe markup is re-inserted
- the tenant iframe reloads unnecessarily

This is why file-tree navigation churns the preview.

### High: save does not have a proper live-reload contract

Current save flow:

- save writes the payload file
- compile runs
- shell fragment re-renders

See:

- [shell/pages/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/pages/home.fuwa:25)
- [runtime/host/capabilities.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua:264)

What it does not do:

- no explicit tenant runtime refresh command
- no preview-preserving patch update
- no stable session/bridge-based hot refresh

So “save + run” currently behaves closer to a shell fragment re-render than a
real IDE live runtime update.

### High: phase 9 browser runtime is only a stub

The public repo has:

- [runtime/browser/init.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/browser/init.lua:1)

This file only provides:

- message type definitions
- message validation helpers
- bootstrap descriptor / `srcdoc` scaffold

What it does **not** provide:

- Wasmoon boot
- worker orchestration
- compile/request execution loop
- tenant request handling in-browser
- bridge to the mounted shell preview

So phase 9 is not implemented. It is only sketched.

### Medium: README overstates current implementation

The README still says the DSL:

- executes in-browser via Wasmoon Web Worker
- persists through SQLite-WASM
- uses `postMessage` runtime layering

See:

- [README.md](/mnt/DATA/development/projects/repos/fuwa/README.md:16)

That is not the current public implementation state.

The public repo today is still primarily:

- route-backed shell
- Lua dev server
- vendored browser widgets
- no full public browser worker runtime

### Medium: shell layout is not parity with the `/IDE` desktop UI

Current shell UI:

- [shell/views/layout.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/layout.fuwa:1)
- [shell/views/fragments/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa:1)

It is a proof shell with:

- hero copy
- payload switch buttons
- file tree
- edit panel
- terminal panel
- route-backed preview

The real `/IDE` desktop surface in:

- [src/ui/desktop/TestPanel.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte:1)

has more:

- denser two-island composition
- breadcrumb/header system
- search popover
- file list dropdown
- runtime status widgets
- asset switcher
- code/terminal single-view toggle
- much more precise shell framing and spacing

So “phase 10” is also incomplete.

## `/IDE` Desktop Features Still Missing In `fuwa`

### Core desktop orchestration

Present in `/IDE`:

- [RuntimeSession.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/RuntimeSession.ts:1)

Missing equivalent in `fuwa`:

- no host-side runtime session model
- no command queue for tenant updates
- no stable run/reset/request orchestration layer
- no adapter abstraction on the public `fuwa` side

### Real phone shell runtime bridge

Present in `/IDE`:

- [PhoneShell.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/PhoneShell.svelte:1)
- [runtime-bridge.js](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/runtime-bridge.js:1)

Missing in `fuwa`:

- no actual iframe bridge loop
- no `ready` handshake
- no `swap`/`reply` message delivery loop
- no path/title/meta propagation

### Search popover and file dropdown

Present in `/IDE`:

- [TestPanel.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte:175)

Missing in `fuwa`:

- no search input popover
- no file list dropdown
- no keyboard selection behavior

### Editor parity

Current `fuwa` editor hook:

- only mounts basic CodeMirror view
- no language package wiring for Lua/fuwa parity
- no file-switching preservation behavior
- no runtime-session ownership

Compared to `/IDE`:

- [EditorPane.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/EditorPane.svelte:1)

### Terminal parity

Current `fuwa` terminal hook:

- mounts xterm
- seeds output
- remounts on shell swap

Compared to `/IDE` terminal:

- [TerminalPane.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/TerminalPane.svelte:1)

Missing:

- true interactive binding
- host runtime input/output lifecycle
- retained session semantics

## Test / QA Results

### Passed

- `lua5.4 tests/compiler_smoke.lua`
- `lua5.4 tests/unit/browser.lua`

### Failed

- `lua5.4 tests/acceptance.lua`
- `lua5.4 tests/dev_server_smoke.lua`

Root cause found:

- [payloads/current/pages/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/pages/home.fuwa:33)

## QA Conclusion

The public `fuwa` repo has enough real work to continue from, but it is still
in the middle of the port.

Accurate state:

- shell proof: yes
- local vendor strategy: yes
- basic widgets: yes
- browser worker runtime: no
- `/IDE` desktop feature parity: no
- live reload / preview refresh quality: no
- stable green QA baseline: no

The next serious task should not be another small patch. It should be a
deliberate **one-shot desktop IDE port plan** that:

1. fixes the failing payload baseline first
2. ports the real `/IDE` desktop shell structure
3. implements the browser runtime bridge properly
4. narrows shell swaps so preview/editor/terminal can update independently
5. preserves `.fuwa`/Lua ownership rather than drifting back to a god JS layer

