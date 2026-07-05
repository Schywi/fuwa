# Step 3: Browser Runtime

Goal: replace the hybrid browser/server shell loop with the exact browser
runtime behavior from `/mnt/DATA/development/projects/repos/IDE`.

This step is not a generic Wasmoon phase anymore. It is a specific parity task:
make browser mode in `fuwa` behave like `/IDE` and stop carrying
draft/publish/server concerns in the live edit path.

## Exact Target

The browser runtime loop must be:

1. CodeMirror emits file contents
2. browser runtime session updates in-memory files
3. browser runtime session debounces a live run
4. worker receives the current in-memory files
5. worker recompiles/runs in-browser
6. bridge swaps tenant HTML into the iframe root

That is the target. Anything involving:

- `/draft/...`
- `/save/...`
- route-backed preview refresh
- server compile on keystroke
- file persistence on keystroke

is outside the target.

## `/IDE` Behavioral Donors

These files define the behavior to copy:

- [TestPanel.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte)
- [RuntimeSession.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/RuntimeSession.ts)
- [adapter.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/adapter.ts)
- [worker.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/worker.ts)
- [runtime-bridge.js](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/runtime-bridge.js)

`/mnt/DATA/development/projects/repos/IDE` is read-only reference material.

## What This Step Must Remove

The current `fuwa` browser path still mixes in server-shell concerns.
This step explicitly removes these from browser mode:

- draft overlays
- background draft persistence
- draft bundle fetches
- publish-first UX
- server preview refresh tokens as the editing trigger
- server driver as part of browser live feedback

The browser path should become self-contained.

## Required Architecture

### 1. One browser session owns browser mode

The browser session is the equivalent of `/IDE`'s `RuntimeSession`.

It owns:

- in-memory file map
- active file selection state relevant to the runtime
- live reload debounce
- worker run lifecycle
- terminal stream updates
- tenant reply/swap dispatch

It does not own:

- disk writes
- publish state
- draft overlay state

### 2. One browser worker owns execution

The worker is the equivalent of `/IDE`'s worker path.

It must:

- boot Wasmoon
- boot SQLite-WASM
- accept the current in-memory file/source state
- run the current request target
- emit HTML/stdout/stderr/done messages

It must not:

- depend on server-side persistence semantics
- require server-side route refresh to update the preview

### 3. One tenant bridge owns DOM updates

The iframe/tenant bridge is the equivalent of `/IDE`'s `runtime-bridge.js`.

It must:

- keep the iframe mounted
- receive swap/reply commands
- rewrite paths as needed
- replace tenant DOM inside a stable root

It must not:

- rely on shell HTMX swaps to make live reload visible

## Implementation Tasks

### Task 1: Refactor `runtime-session.js` into `/IDE` parity

The session should expose an API shaped around editing, not drafts:

```js
session.updateCode(path, contents)
session.setActiveFile(path)
session.run()
session.handleTenantRequest(request)
session.dispose()
```

Key behavior:

- `updateCode(path, contents)` mutates in-memory state immediately
- it schedules one debounced live run internally
- live run uses the session's current in-memory files
- no draft overlay or persistence is consulted

### Task 2: Boot from bundle once, then own memory

The browser runtime still needs an initial source of truth at startup.
That should be:

- fetch browser bundle once
- initialize in-memory files/sources once
- after that, treat in-memory state as authoritative

Do not keep returning to the server as part of every edit.

### Task 3: Make `preview-browser.js` thin

`preview-browser.js` should only:

- mount browser iframe
- create browser session
- pass tenant messages through
- dispose cleanly

It should not:

- decide persistence policy
- own debounce policy
- own draft state

### Task 4: Reduce `preview.js` to mode/lifecycle only

`preview.js` should stop owning browser live update semantics.
After this refactor it should do only:

- toggle browser/server mode if server mode still exists during transition
- mount/dispose the chosen driver
- maintain shell-level lifecycle hooks

It should not:

- post drafts
- debounce browser edits
- act as the runtime session owner

### Task 5: Remove browser-mode draft UI and routes from the target

Browser mode target UI should not expose:

- draft indicator
- discard draft
- `Publish + run`
- server-runtime explanatory text

If those survive temporarily during rollout, they must be clearly treated as
transitional debt, not part of the target design.

### Task 6: Keep tenant requests working through the browser session

The tenant iframe still needs HTMX request handling.
That should keep using:

- tenant request -> browser session
- browser session -> worker run
- worker html -> tenant reply

This matches `/IDE`.

## Runtime Topology

```text
editor.js
    |
    v
runtime-session.js
  |- updateCode(path, contents)
  |- scheduleLiveRun()
  |- run(current_files)
    |
    v
runtime-worker.js
  |- Wasmoon
  |- SQLite-WASM
  |- compile + request loop
    |
    v
tenant-runtime.js
  |- swap/reply
  |- stable iframe root
```

## What Stays Out of Scope

This step does not define:

- persistence
- publish workflow
- server-mode authoring workflow
- saving browser edits to payload files

Those are separate future features if they are needed at all.

## Acceptance Criteria

1. browser mode edits never call `/draft/...`
2. browser mode edits never call `/save/...`
3. browser mode edits never require `Publish + run`
4. browser mode live reload is session-owned, not preview-controller-owned
5. browser mode worker runs use current in-memory file state
6. iframe remains mounted while editing
7. tenant HTMX requests continue to work through the browser runtime
8. the result matches `/IDE` behavior, not a hybrid shell/server model

## Short Version

Stop treating browser mode as a decorated server mode. Rebuild it as a direct
copy of `/IDE`'s in-memory browser runtime session: edit -> session state ->
debounced worker run -> tenant swap.
