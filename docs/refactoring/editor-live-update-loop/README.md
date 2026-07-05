# Editor Live Update Loop

Status: implementation plan.

This plan is narrower than the full IDE port work. It focuses on the exact
problem you hit in the browser UI:

- typing in CodeMirror does not behave like `/IDE`
- the current `fuwa` shell still feels publish-first
- `Publish + run` is doing too much of the work that should happen while
  editing
- file clicks still churn the workspace too aggressively

The target is not "more widget mount code". The target is to make editor changes
flow through the same kind of immediate runtime-session loop that `/IDE` uses.

## What We Verified

Current `fuwa` pieces that already exist:

- the editor widget emits `fuwa:editor-change`
- the preview controller listens for editor changes
- the runtime-session helper already has a live-update path
- the workspace shell already has draft indicators and a publish action

Relevant files:

- [shell/hooks/editor.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/editor.js)
- [shell/hooks/preview.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/preview.js)
- [shell/hooks/runtime-session.js](/mnt/DATA/development/projects/repos/fuwa/shell/hooks/runtime-session.js)
- [shell/views/fragments/workspace.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/workspace.fuwa)
- [shell/pages/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/pages/home.fuwa)
- [runtime/browser/init.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/browser/init.lua)

The key gap is not that the code is missing entirely. The gap is that the edit
signal is not driving the same user-visible behavior as `/IDE`.

## What `/IDE` Does Differently

In `/IDE`, the editor change path is direct:

- `EditorPane` calls `session.updateCode(value)` on change
- `RuntimeSession.updateCode()` updates file state immediately
- the session schedules the next live run itself
- save/publish is not the only way the user sees progress

That produces the feel you want:

- editing updates the runtime loop
- the UI stays responsive
- the preview is not treated like a full page refresh target

## What `fuwa` Does Today

The current `fuwa` flow is closer to a draft pipeline:

- editor emits a change event
- preview controller batches edits
- draft writes are persisted on a debounce
- `Publish + run` is still the obvious user action
- file changes still lead to larger workspace swaps than they should

That is why it feels wrong in browser mode.

## Goal

Make the browser IDE behave like this:

1. typing updates the in-memory runtime session
2. the preview and terminal reflect the change automatically
3. publish remains an explicit action for durable writes
4. file selection does not recreate the iframe
5. the workspace shell keeps the preview mount stable

## Implementation Plan

### Step 1: Separate edit state from publish state

The current system mixes these two concerns too much.

Do this:

- keep an editor-side transient "dirty" state
- keep a publish state for persisted files
- keep a runtime-session state for live preview

Do not let `Publish + run` remain the only path that feels alive.

Acceptance:

- typing in the editor marks the file dirty
- publish is clearly different from live edit feedback

### Step 2: Make editor changes drive the runtime session directly

The editor hook already emits `fuwa:editor-change`.
Use that event as the input to the runtime-session loop instead of treating it
as a draft-only signal.

The live path should:

- update the selected file contents in memory
- schedule a short debounced runtime refresh
- preserve unsaved text in the editor
- avoid re-mounting the whole shell

This is the `fuwa` equivalent of `/IDE`'s `session.updateCode(value)`.

Acceptance:

- typing causes an automatic live refresh path
- there is no need to press `Publish + run` just to see the edit take effect

### Step 3: Narrow the HTMX swap targets

The current shell still swaps too much of the workspace.

Refactor the fragment boundaries so that:

- file clicks update only the editor/workspace subregion they actually need
- the preview iframe mount is not destroyed on simple file selection
- the terminal area is not rebuilt just because the active file changed

Practical rule:

- `#ide-workspace` should not be the swap target for every sub-action
- the preview mount needs a stable container
- sub-panels should be swappable independently

Acceptance:

- clicking a file does not reload the mounted preview iframe
- the shell keeps the preview node stable across editor navigation

### Step 4: Promote the preview controller to the session orchestrator

`shell/hooks/preview.js` is currently where the split runtime logic lives.
It should become the authoritative host-side coordinator for:

- editor change events
- draft writes
- browser runtime mode
- server runtime mode
- refresh behavior

The controller should decide:

- browser mode: send the edit into the browser runtime session and refresh the
  worker-backed preview
- server mode: persist the draft and refresh the route-backed preview without
  replacing the shell

Acceptance:

- the UI behavior changes by runtime mode, but the editor path stays the same

### Step 5: Make publish an explicit durability action

Keep `Publish + run`, but demote it from the default "this is how I make things
move" behavior.

The button should mean:

- persist the current draft to the real payload source
- compile or rebuild from durable sources
- refresh the preview from the durable path

It should not be required for ordinary typing feedback.

Acceptance:

- publish is for durable writes
- live typing is for immediate feedback

### Step 6: Preserve draft recovery

One thing the current `fuwa` shell does well is preserve unsaved edits across
swaps.

Keep that behavior:

- if the workspace rerenders, restore pending text
- if the file is still dirty, keep that state visible
- do not destroy the user's work because a panel refreshed

Acceptance:

- file swap or shell swap does not drop edits already typed into CodeMirror

### Step 7: Add tests for the exact regressions

Add or extend tests so these are covered:

- editor change emits a live-update event
- live update runs without requiring publish
- file click does not recreate the preview iframe
- save/publish does not cause full page reload behavior
- browser mode and server mode both respond to edit changes

Suggested test targets:

- [tests/dev_server_smoke.lua](/mnt/DATA/development/projects/repos/fuwa/tests/dev_server_smoke.lua)
- [tests/acceptance/shell_host.lua](/mnt/DATA/development/projects/repos/fuwa/tests/acceptance/shell_host.lua)
- new tests for the live editor loop

## What This Plan Is Not

- not a Wasmoon rewrite by itself
- not a desktop parity project by itself
- not a mobile port
- not a new framework
- not a shift back to JS app ownership

This is the smallest plan that makes the edit loop feel like `/IDE`.

## Acceptance Criteria

The plan is complete when:

1. typing in CodeMirror visibly affects the runtime loop without needing
   `Publish + run`
2. the editor preserves unsaved text across shell swaps
3. file selection no longer reloads the preview iframe unnecessarily
4. publish remains available as the durable-write path
5. browser mode and server mode both preserve the same direct editor-change
   mental model

