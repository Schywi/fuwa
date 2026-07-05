# Editor Live Update Loop

Status: implementation plan.

This plan is intentionally strict. It does **not** preserve the current
`fuwa` draft/publish model for browser mode. The target is the browser live
reload pipeline from `/mnt/DATA/development/projects/repos/IDE` as closely as
possible.

## Non-Goals

Browser mode must **not** include any of these concepts in the live edit path:

- draft overlays
- `POST /draft/...`
- publish buttons as a prerequisite for feedback
- server-side file writes on keystroke
- server-side compile on keystroke
- durability/persistence concerns

If the implementation needs those concepts to make browser mode "work", it is
the wrong implementation.

## Source of Truth

Browser live reload should mirror this `/IDE` chain:

1. editor change calls `session.updateCode(value)`
2. runtime session mutates in-memory file state immediately
3. runtime session debounces a live run internally
4. adapter posts the current in-memory files to the worker
5. worker runs the code and emits HTML
6. bridge swaps the tenant DOM without recreating the iframe

Reference files:

- [TestPanel.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte)
- [RuntimeSession.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/RuntimeSession.ts)
- [adapter.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/adapter.ts)
- [worker.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/worker.ts)
- [runtime-bridge.js](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/runtime-bridge.js)

## Current `fuwa` Mismatch

The current `fuwa` browser path is still structurally wrong for this target:

- the preview controller still knows about draft behavior
- the browser session still carries "published bundle plus overlay" assumptions
- the shell UI still exposes publish/draft semantics
- server mode and browser mode still share too much behavior

Those are not polish issues. They are architectural mismatches.

## Target Behavior

Browser mode in `fuwa` should behave like this:

1. user types in CodeMirror
2. editor emits `{ path, contents }`
3. browser runtime session updates its in-memory sources immediately
4. browser runtime session schedules one debounced live run
5. worker receives the full in-memory source map
6. worker recompiles and runs in-browser
7. tenant bridge swaps returned HTML into the mounted runtime root

The path above must not hit:

- `/draft/...`
- `/save/...`
- `write_payload_file`
- `compile_payload`
- route-backed preview refresh

## Required Refactor

### Step 1: Split browser mode from server mode completely

Do not keep one hybrid live-update controller.

`preview.js` should stop being the owner of browser editing semantics.
Its job should become:

- mode toggle
- browser driver mount/dispose
- server driver mount/dispose
- nothing else

Browser mode should have its own direct runtime-session loop.

Acceptance:

- browser typing no longer depends on any draft/publish logic
- server mode may still exist separately, but browser mode does not share its
  persistence model

### Step 2: Make `runtime-session.js` the browser-mode owner

`runtime-session.js` should become the exact equivalent of `/IDE`'s
`RuntimeSession`.

It must own:

- current in-memory file map
- active file content
- live reload debounce
- worker run requests
- terminal output
- tenant swap commands

It must **not** rely on:

- draft overlay files
- server-built preview routes
- any "publish first" concept

Acceptance:

- browser live reload is driven by session state only

### Step 3: Add `updateCode(path, contents)`

`fuwa` cannot copy `/IDE`'s single-file `updateCode(next)` API exactly because
the shell passes file paths explicitly.

So the `fuwa` browser session should expose:

```js
session.updateCode(path, contents)
```

That method must:

- update the authoritative in-memory source map
- update the selected file contents immediately
- mark the runtime session dirty in memory only
- schedule the live run internally

It must not:

- write to disk
- fetch draft routes
- refresh the server preview

Acceptance:

- editor changes affect browser runtime state immediately

### Step 4: Remove draft bundle semantics from browser mode

The browser runtime must stop depending on `bundle.json?draft=1`.

Correct browser-mode model:

- boot from the published browser bundle once
- extract the initial source map once
- after that, use the in-memory source map as truth
- every live run posts that in-memory source map to the worker

That matches `/IDE`, where the in-memory file map is the source of truth during
editing.

Acceptance:

- browser live reload does not depend on server overlay sources

### Step 5: Move debounce into the runtime session

The debounce belongs inside the browser runtime session, not in the shell
preview controller.

Match `/IDE`'s shape:

- editor change -> `session.updateCode(...)`
- `session.scheduleLiveRun()`
- worker run

This keeps browser live reload deterministic and removes controller-level
coupling.

Acceptance:

- no browser-mode debounce logic remains in `preview.js`

### Step 6: Keep `preview-browser.js` thin

`preview-browser.js` should be a driver, not a workflow controller.

It should only:

- mount the runtime iframe
- create the runtime session
- bridge tenant messages
- expose `refresh()` and `dispose()`

It should not:

- own draft logic
- own live edit semantics
- own persistence logic

Acceptance:

- browser driver becomes plumbing only

### Step 7: Remove browser-mode draft UI

If browser mode is in-memory only, then browser mode must not show:

- draft indicator
- discard draft action
- `Publish + run`
- server runtime toggle copy that implies persistence semantics

Those controls can only survive if they are explicitly scoped to a separate
server-mode workflow. They are not part of `/IDE`-style browser live reload.

Acceptance:

- browser mode UI stops advertising draft/publish concepts

### Step 8: Keep the iframe stable

The browser tenant iframe must remain mounted while editing.

Browser live reload should update the tenant root by message/HTML swap, not by:

- iframe recreation
- shell fragment recreation
- HTMX workspace replacement

Acceptance:

- typing never recreates the browser runtime iframe

### Step 9: Preserve tenant request handling

After the refactor, tenant HTMX requests inside the browser runtime still need
to flow through the worker-backed request loop.

That means the browser session must continue to support:

- request -> worker run
- worker html -> tenant reply
- same iframe/root

This is still the `/IDE` bridge model.

Acceptance:

- browser live reload and browser HTMX requests share one runtime session

### Step 10: Treat persistence as a separate future feature

If persistence comes back later, it must be added as a **separate** feature
after browser parity exists.

It must not contaminate the core browser live-reload loop.

That means:

- no "temporary publish"
- no "background draft save"
- no "overlay but hidden"

Persistence is out of scope for this plan.

## File-by-File Target

- [editor.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/editor.js)
  - keep emitting `{ path, contents }`
  - no persistence semantics

- [preview.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/preview.js)
  - reduce to mode toggle and driver lifecycle only
  - remove browser draft/publish logic

- [preview-browser.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/preview-browser.js)
  - mount iframe
  - create runtime session
  - bridge messages
  - no workflow ownership

- [runtime-session.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/runtime-session.js)
  - own browser editing state
  - add `updateCode(path, contents)`
  - own live reload debounce
  - run worker from in-memory source state

- [runtime-worker.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/runtime-worker.js)
  - continue to accept source-driven runs
  - no draft overlay dependence

- [tenant-runtime.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/tenant-runtime.js)
  - keep stable swap/reply behavior

- [workspace.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/workspace.fuwa)
  - remove browser-mode draft/publish affordances from the target UI

## Acceptance Criteria

The plan is complete when all of these are true:

1. typing in browser mode updates preview without publish
2. typing in browser mode does not hit `/draft/...`
3. typing in browser mode does not hit `/save/...`
4. typing in browser mode does not write to disk
5. browser-mode debounce lives in the runtime session
6. browser-mode source of truth is in-memory only
7. browser runtime iframe stays mounted during edits
8. tenant HTMX requests still work through the worker runtime
9. browser mode no longer exposes draft/publish UI concepts

## One Sentence Summary

Port `/IDE`'s browser runtime loop exactly: editor change -> runtime session
state update -> debounced worker run -> tenant DOM swap, with no draft,
publish, server compile, or persistence concerns in the live path.
