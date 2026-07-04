# Claude Fable 5 One-Shot Prompt

Use this as a direct implementation brief for a strong coding model.

## Prompt

You are working in `/mnt/DATA/development/projects/repos/fuwa`.

`/mnt/DATA/development/projects/repos/IDE` is **read-only reference material**.
Do not edit files there. Do not move, delete, or rewrite anything in `IDE`.
Use it only to inspect the existing Svelte implementation and port behavior into
`fuwa`.

Do not ask questions. Do not stop after analysis. Do not produce a phased plan
instead of implementation. Execute the port in one cohesive pass, while keeping
the repo buildable and testable.

Your goal is to **properly port the desktop Svelte IDE from**
`/mnt/DATA/development/projects/repos/IDE` **into the Lua / `.fuwa` codebase in**
`/mnt/DATA/development/projects/repos/fuwa`, extending what is already there.

This is not a greenfield rewrite and not a mockup task. It is a feature and
architecture port.

## Read first

Read these `fuwa` repo files before touching anything:

- `/mnt/DATA/development/projects/repos/fuwa/README.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/README.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/01-mental-model.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/06-views-and-templates.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/browser-ide-wiring/README.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/shell-architecture.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/shell-sequencing-part2.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/shell-sequencing-part3.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/telemetry-plan.md`

Read these implementation sources in `fuwa`:

- `/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/host/dashboard.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/host/shell_views.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/browser/init.lua`
- `/mnt/DATA/development/projects/repos/fuwa/shell/views/layout.fuwa`
- `/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa`
- `/mnt/DATA/development/projects/repos/fuwa/shell/hooks/editor.js`
- `/mnt/DATA/development/projects/repos/fuwa/shell/hooks/terminal.js`

Read these `/IDE` sources as the feature-parity target:

- `/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/EditorPane.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/TerminalPane.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/PhoneShell.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/runtime-bridge.js`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/RuntimeSession.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/adapter.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/worker.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/types.ts`

## Non-negotiable architecture rules

1. `shell/` is the desktop IDE host.
   - It owns the desktop shell UI, hero, file navigation, popovers, dropdowns,
     editor panel, terminal panel, and phone shell visuals.

2. `payloads/` are tenant lesson/apps.
   - They remain the mounted app content and sandboxed preview target.

3. `runtime/` is substrate.
   - It owns compilation, host capabilities, browser runtime, worker boot,
     bridge contracts, DB providers, and request handling.

4. Do not teach the compiler that “host” exists.
   - Capability resolution stays a runtime concern.

5. Keep `.fuwa` for screen-shaped host UI.
   - Use `shell/hooks/*.js` only as narrow imperative widget and bridge glue.
   - Do not rebuild a JS god framework.

6. Desktop only.
   - Do not port the mobile UI in this pass.

7. Preserve the existing shell visual baseline where possible, but achieve
   parity with the real `/IDE` desktop composition and interaction model.

## Current repo truths you must respect

- The shell proof is already implemented.
- Payloads already mount via route-backed iframe documents.
- CodeMirror and xterm vendor assets already exist.
- Current editor/terminal hooks already exist, but are shallow.
- `runtime/browser/init.lua` is only a stub today.
- The current payload baseline is actually broken by a syntax regression:
  `/mnt/DATA/development/projects/repos/fuwa/payloads/current/pages/home.fuwa`
  has a malformed string terminator. Fix this first so the baseline is green.

## What you must implement

### 1. Fix the current broken baseline first

Before doing any larger port:

- fix the syntax regression in `payloads/current/pages/home.fuwa`
- get the current `fuwa` tests green again
- do not build on top of a broken payload baseline

### 2. Port the desktop IDE shell composition from `/IDE`

Bring the real desktop shell structure from `TestPanel.svelte` into `shell/`,
adapted to `.fuwa` + Lua:

- left preview/phone stage
- right control/workspace panel
- header with runtime status, asset selection, breadcrumb-like context
- search popover
- file list dropdown
- code/terminal toggle or equivalent view control
- denser, more intentional desktop panel layout

Do not stop at the current proof shell with:

- static hero copy
- file list
- textarea fallback
- route-backed badge

### 3. Implement the real browser runtime substrate

Complete phase 9 properly:

- add the actual Wasmoon worker runtime path in `fuwa`
- add SQLite-WASM browser provider support
- implement the real worker message loop
- implement runtime boot, payload load, request dispatch, HTML reply, and
  terminal/log streaming
- bridge the worker runtime to the mounted tenant iframe

Use the `/IDE` engine and bridge files as the behavior reference, but port them
into the `fuwa` repo architecture rather than copying TypeScript wholesale.

### 4. Implement a host runtime-session equivalent

The current shell lacks the orchestration layer that makes the `/IDE` usable.

Add a `fuwa`-appropriate equivalent of:

- active file selection
- file contents state
- run/reset lifecycle
- live reload scheduling
- tenant command queue
- terminal binding
- preview session lifecycle

This can be split across Lua runtime state plus thin host hooks, but the
behavior needs parity with `/IDE`.

### 5. Stop reloading the preview iframe on unrelated shell updates

Current bug:

- file inspection and save swap the whole shell fragment
- that recreates the iframe
- preview reloads when it should not

Refactor the shell fragment boundaries so that:

- file tree selection only updates the editor region and any small dependent UI
- save/run updates terminal and preview intentionally
- preview mount DOM is not destroyed by unrelated shell actions

This is required.

### 6. Make live reload behave like an IDE, not a full app refresh

Current bug:

- save behavior causes page churn and awkward reload behavior

Implement proper host-driven update behavior:

- file edits update shell/editor state
- save triggers compile/run
- terminal updates with compile result
- preview refreshes through the runtime seam
- the whole shell page should not fully reload for a normal save loop

### 7. Port search, popover, dropdown, and file navigation behavior

These are not optional polish.

Port desktop-only equivalents for:

- search popover
- file list dropdown
- keyboard-accessible file selection
- active file highlighting
- contextual header/breadcrumb state

Match the behavior and information architecture of `/IDE`.

### 8. Deepen CodeMirror and xterm integration

Current hooks are only mount wrappers.

Extend them so they support:

- stable remount behavior
- file switch without accidental preview churn
- sync between editor view and form/runtime state
- proper terminal session retention and append behavior
- terminal clear/run loop similar to `/IDE`

### 9. Keep vendor-driven runtime dependencies

Do not introduce npm as the runtime delivery path.

Use repo-local vendor/static assets for:

- htmx
- petite-vue
- CodeMirror
- xterm
- Wasmoon
- SQLite-WASM
- UnoCSS runtime where needed

### 10. Update docs if behavior changes materially

If the real implementation diverges from the README or refactoring docs:

- extend docs
- do not silently leave inaccurate architecture claims behind

## Implementation constraints

- Prefer editing existing `fuwa` runtime pieces over inventing parallel systems.
- Keep Lua as the source of truth for runtime behavior.
- Keep `.fuwa` as the source of truth for host screens.
- Keep JS hooks narrow and host-only.
- Do not remove working tests.
- Add or adjust tests for:
  - payload route baseline
  - shell search/file selection behavior
  - non-destructive preview updates
  - save/run loop
  - browser runtime message contract

## Acceptance criteria

The work is only complete if all of this is true:

1. Current payload route bug is fixed and QA baseline is green.
2. Desktop shell in `fuwa` clearly matches the real `/IDE` desktop IDE shape.
3. Search popover, file dropdown, and contextual header are implemented.
4. Editor and terminal are real host tools, not shallow placeholders.
5. Preview iframe does not reload on unrelated file-tree/editor shell swaps.
6. Save/run refreshes preview intentionally and updates terminal output.
7. A real browser runtime path exists in `fuwa`, not just a stub descriptor.
8. Vendor-local assets are used for runtime dependencies.
9. The host/payload/substrate boundary remains clean.
10. Tests pass.

## Final instruction

Do not stop at analysis. Do not ask clarifying questions. Do not break the task
into “future phases” and stop. Implement the port in one coherent pass on top
of the current `fuwa` repo, using `/IDE` as the concrete feature-parity source.
