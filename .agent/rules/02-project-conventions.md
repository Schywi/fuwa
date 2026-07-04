# Project conventions — fuwa specifics

The principles in `00-principles.md` and the smells in `01-antipatterns.md` apply
everywhere. This file is what makes them concrete *for fuwa*. Read
`README.md` (repo root), `docs/architecture.md`, and
`docs/port-compiler-to-lua.md` before writing code — they define the system these
rules protect.

## What fuwa is (so you write host-agnostic code)

A `.fuwa` DSL compiles to **Lua**, which runs in-browser via a Wasmoon Web Worker
with SQLite-WASM for persistence, rendered by a light tenant stack (petite-vue,
htmx, UnoCSS). Lua is the main language. JavaScript is glue only.

## The non-negotiable rule: the compiler boundary

Per `docs/port-compiler-to-lua.md`, the compiler is split into two layers, and
this boundary is **the** architectural invariant of the repo:

1. **`compiler.core`** — parse `.fuwa`, emit Lua modules + `view.lua`, return
   diagnostics. It returns **only** compiled Lua artifacts plus diagnostics — no
   manifest, no runtime id, no dev-server policy.
2. **`package_web`** — wraps the core, synthesizes `main.lua`, passes through
   non-`.fuwa` assets, exposes the `build()` the dev server calls.

Rules that follow from this:

- The **core compiler must know nothing** about: Svelte, `RuntimeSession`,
  browser workers, Wasmoon, adapter blobs, `__BROWSER_JS__`, TypeScript host
  state, HTTP, file watching, SSE, `socat`, `flock`, or reload scripts. If you
  find yourself importing any of that into the core, you are breaking the layering
  — stop.
- Data flows **dev server → `package_web` → `compiler.core`** and never the
  reverse. The core does not call up.
- Do not share helpers across this boundary just because code looks similar
  (see DRY caveat in `00-principles.md`). The whole point is that they can change
  independently.
- `repos/IDE` (`src/engine/compiler.ts`) is a **semantic donor only** — a
  behaviour/grammar/output-shape reference. Do **not** port its host-shaped API
  contract into this repo.

## Follow the documented layout

The compiler port has a prescribed module layout (`runtime/stdlib/compiler/…`)
and per-module responsibilities in `docs/port-compiler-to-lua.md`. Put code in
the module that owns that responsibility; do not port into one giant
`compile.lua`, and do not invent a parallel layout. If a responsibility has no
home, that is a design conversation, not a new folder.

## Honor the documented contracts

The result shapes for `compile_runtime_files(...)` and `web.build(...)` are
specified in `docs/port-compiler-to-lua.md` (the `{diagnostics, modules}` and
`{diagnostics, run_files}` tables). Match them exactly. Errors go through the
`diagnostics` list — never `print`, never a thrown string that escapes the
documented channel, never a silent empty result (see antipattern #6).

## Lua conventions

- `local` everything. No accidental globals — a stray global in Lua is a bug that
  fails silently.
- `snake_case` for functions and variables; `UpperCamelCase` only for
  module/"class" tables. Match the file you are in.
- Return a module table at the bottom; keep the public surface small and explicit.
- Prefer explicit scanners/state machines over cute Lua patterns where the
  grammar is non-trivial. Lua patterns are **not** regex — translating TS regex
  directly is the biggest low-level risk called out in the plan. When a pattern
  is subtle, add a `why` comment and a test.
- Keep I/O (file reads, sockets) out of the core entirely (see the boundary
  rule).

## Minimal JavaScript

JS is bootstrap/glue around the compiled Lua (`hooks/*.js`, `browser.js`) — not a
place to grow logic. A previous commit already reverted an unintended Node/JS
runtime (`db4af76`). Do not reintroduce a JS toolchain, a Node runtime, or
build-time JS logic into the Lua path. If a task seems to need one, stop and ask.
When a shell or tenant interaction is naturally stateful in the DOM, prefer
petite-vue state/directives over bespoke JS hooks. Do not replace a simple
petite-vue interaction with a custom delegated DOM state machine.
When HTMX swaps a subtree, put `v-scope` on the closest stable ancestor that is
not replaced by that swap. Stateful shell chrome should live above the swap
boundary or be explicitly preserved; do not attach petite-vue state to the node
HTMX is about to replace and then expect the state to survive.

## `.fuwa` language work

The MVP goal is **parity** with the current language, not redesign. Support the
existing constructs listed in the plan (`module`, `use`, `import…end`, `schema`,
`routes`, `action`, `render`, `redirect`, `fail`, `match`, `if … ->`, `?` sugar,
`view.fuwa`) with the current semantics. Do not "improve" or clean up the
language surface as a side effect of porting.

## Compile-time vs runtime composition (phase discipline)

`.fuwa` has **two phases that never overlap**, and mixing them is a category
error, not a bug you can patch:

- **Compile-time / static composition** — `<include src="..."/>` is expanded by
  the compiler (`runtime/stdlib/compiler/view.lua`) via one narrow macro shape:
  `<include%s+src="([^"]+)"%s*/>`. It is copy-paste that happens **before** the
  program runs, like `#include`.
- **Runtime / dynamic composition** — `f-if`, `f-for`, and friends are evaluated
  by the renderer (`runtime/stdlib/view.lua`) **while** the program runs.

The rule:

> **Static composition is the compiler's job; conditional composition is the
> runtime's job.** The moment you want an `if` around *structure*, that structure
> must be chosen at runtime — never by decorating a macro.

Concretely:

- **Do not** put `f-if` (or any runtime directive) on an `<include>`. The macro
  matcher won't recognize the decorated tag, so it won't expand; the renderer then
  emits `<include …>` as **literal text** because `include` has no runtime meaning.
  This is the phase bug behind fragment responses printing raw `<include>` tags.
- To choose between templates (e.g. full-page vs fragment), decide **at the route
  or action level** which already-expanded view to render. Two entrypoints/
  templates, one runtime choice.
- **Do not** "fix" this by teaching the compiler to expand conditional includes.
  That drags runtime semantics into the macro phase and blurs the compile/runtime
  line this file exists to protect — curing a phase confusion by institutionalizing
  it. If a real need for runtime structural composition appears, it is a
  language-design conversation, not an ad-hoc compiler extension.

## Tests / fixtures

Follow the plan's golden-fixture approach: capture reference output from the IDE
compiler and compare (module outputs for the core, the runnable file map for
packaging). Include a happy path, the real fixtures (`fuwa-gomen`, `gomen-v2`),
and at least one intentionally broken fixture so diagnostics are covered. New
behaviour gets a fixture; do not mark work done without one.
