# Shell Hooks Native ESM Plan

## Scope

This plan covers browser-host JavaScript that powers the shell/IDE experience:

- `shell/hooks/editor.js`
- `shell/hooks/terminal.js`
- `shell/hooks/workspace.js`
- `shell/hooks/runtime-session.js`
- `shell/hooks/runtime-worker.js`
- `shell/hooks/preview-browser.js`
- `shell/hooks/preview.js`
- `shell/hooks/observability.js`
- `shell/hooks/motion.js`
- `shell/hooks/cursor.js`
- `shell/hooks/tmux.js`
- `shell/hooks/tenant-runtime.js`

It does **not** cover payload JS design. That is a separate plan.

## Problem statement

Today the shell JS is in a hybrid state:

- shell scripts are loaded as classic `defer` scripts
- import maps already exist
- some features use native `import(...)`
- the worker still uses `importScripts(...)`
- cross-file coordination still leans on globals and implicit load order

This works, but it is harder to reason about than necessary. Native browser ESM
would make ownership and dependencies more explicit without introducing Vite,
Babel, npm, or a Node build path.

## Non-goals

- No Vite migration
- No Babel
- No npm runtime dependency
- No build step for shell JS
- No compiler-core changes
- No "convert every file at once" big bang rewrite

## Current constraints

The current shell already relies on browser-native module features:

- import map in `shell/views/layout.fuwa`
- dynamic imports for CodeMirror and xterm
- dynamic module import in the worker for SQLite WASM

That means the browser baseline is already modern enough for a native ESM-first
design. The main issue is consistency and structure, not feasibility.

## Desired end state

1. `shell/hooks` becomes explicitly module-based.
2. File dependencies are visible through `import`/`export`, not hidden through
   globals or load order.
3. The runtime worker becomes a module worker if and only if that reduces
   glue and does not regress current browser support expectations.
4. The shell layout loads a small number of entry modules, not a long list of
   classic scripts.
5. Import maps remain vendor-local and human-readable.
6. No Node/Vite layer is introduced.

## Recommended module shape

### Entry points

- `shell/hooks/browser/index.js`
  Main shell browser entry point.
- `shell/hooks/browser/tenant-entry.js`
  Tenant runtime entry point for embedded browser runtime pages.

### Shared libraries

- `shell/hooks/browser/lib/dom.js`
- `shell/hooks/browser/lib/events.js`
- `shell/hooks/browser/lib/log.js`
- `shell/hooks/browser/lib/http.js`
- `shell/hooks/browser/lib/swap-lifecycle.js`

### Feature modules

- `shell/hooks/browser/editor/index.js`
- `shell/hooks/browser/terminal/index.js`
- `shell/hooks/browser/workspace/index.js`
- `shell/hooks/browser/preview/index.js`
- `shell/hooks/browser/observability/index.js`
- `shell/hooks/browser/motion/index.js`
- `shell/hooks/browser/cursor/index.js`
- `shell/hooks/browser/tmux/index.js`
- `shell/hooks/browser/runtime/session.js`
- `shell/hooks/browser/runtime/worker-client.js`
- `shell/hooks/browser/runtime/tenant-runtime.js`

This preserves the browser/shell ownership split the repo already wants without
mixing it into payload code.

## Migration sequence

### Phase 0: Freeze behavior

Before any file moves:

- identify current public globals that other scripts depend on
- identify HTMX lifecycle events each module listens to
- identify worker message contracts that must remain stable
- capture tests for:
  - editor mount/unmount across swaps
  - terminal detach/remount behavior
  - preview session boot and update flow
  - deploy trigger flow
  - observability event flow

This phase is mandatory because ESM refactors often accidentally break timing.

### Phase 1: Introduce module entry points without changing internals

Goal:
- keep logic the same
- change loading shape first

Steps:

1. Add `shell/hooks/browser/index.js` that imports existing feature files.
2. Move shell layout from many classic `defer` scripts to one module script.
3. Keep existing files mostly intact by wrapping their startup in exported
   functions.
4. Keep import map usage for CodeMirror as-is.

Success criteria:

- shell still boots
- no global load-order dependency remains in the layout
- no behavior change intended

### Phase 2: Turn feature files into real modules

Goal:
- remove hidden globals and implicit coupling

Steps:

1. Convert each major feature file into explicit exports.
2. Replace cross-module `window.*` handoffs with imported helpers.
3. Extract tiny shared helpers only when repeated three or more times.
4. Keep feature-local helpers local.

Order:

1. `observability`
2. `workspace`
3. `editor`
4. `terminal`
5. `preview`
6. `runtime-session`
7. `tmux`, `motion`, `cursor`

This order starts with lower-risk modules and leaves the runtime core later.

### Phase 3: Revisit the worker loading model

Current state:

- worker is created as a classic worker
- worker uses `importScripts(...)` for Wasmoon
- worker uses dynamic `import(...)` for SQLite WASM

Options:

#### Option A: keep classic worker

Pros:

- smallest blast radius
- keeps current Wasmoon boot path unchanged
- less risk around import map limitations in workers

Cons:

- still hybrid
- less explicit module structure in worker code

#### Option B: migrate to module worker

Pros:

- cleaner module graph
- easier to split large worker logic into modules

Cons:

- more compatibility and path-resolution risk
- import maps do not apply to workers the same way they do to documents
- may force changes around vendor asset bootstrapping

Recommendation:

- start with Option A
- only move to a module worker if the classic worker becomes the last awkward
  holdout and there is a clear readability win

This is a YAGNI call: do not chase module purity if the worker does not need it.

### Phase 4: Tighten folder ownership

After behavior is stable:

- move browser-host JS under `shell/hooks/browser/`
- keep shell chrome modules under `shell/hooks/shell/` only if they are truly
  shell-only and not runtime/browser owned
- update docs so the folder tree itself teaches the architecture

Do this after ESM adoption, not before. File moves plus behavior changes in the
same step create unnecessary review noise.

## Testing plan

### Unit-level

- module boot helpers
- event adapter helpers
- worker message serialization helpers
- observability append logic

### Browser integration

- editor survives view switches
- terminal preserves scrollback on remount
- runtime session recompiles and rerenders on edit
- deploy action still exports snapshot correctly
- traces still flow into `/__dev/traces`

### Manual regression checklist

- open file
- edit code
- preview rerenders
- terminal updates
- traces show activity
- deploy still redirects successfully
- tmux/debug panels still mount

## Risks

### Risk: load-order regressions

Mitigation:

- one entry module
- explicit imports
- behavior freeze tests first

### Risk: worker boot regressions

Mitigation:

- keep classic worker first
- treat module-worker migration as optional later work

### Risk: accidental architecture drift

Mitigation:

- do not mix payload refactors into this work
- do not introduce Node/Vite/Babel
- do not move logic into JS just because imports are easier

## Success criteria

- shell JS loads from one or a few native module entry points
- major shell features use explicit imports/exports
- no Node/Vite/Babel introduced
- import map remains vendor-local and readable
- behavior matches today
- resulting code is easier to navigate than the current classic-script hybrid

## What not to do

- do not convert everything in one giant commit
- do not rewrite payload code during shell ESM work
- do not add abstraction layers just because modules make them easy
- do not chase "perfect" module purity at the cost of readable code

## Recommended implementation slices

1. module entrypoint plus layout loading change
2. observability/workspace extraction
3. editor/terminal extraction
4. preview/runtime-session extraction
5. optional worker follow-up
6. final folder move and cleanup
