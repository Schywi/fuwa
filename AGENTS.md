# AGENTS.md — rules for AI agents working in fuwa

> This is the Codex entry point. Codex reads `AGENTS.md` from the repo root
> automatically. It is deliberately thin: the real rules live in
> [`.agent/rules/`](.agent/rules/) so there is one source of truth, not copies
> that drift.

**Read `.agent/rules/` before writing any code, and follow it.** In order:

1. [`.agent/rules/00-principles.md`](.agent/rules/00-principles.md) — what
   readable/clean code means here, with the buzzwords (DRY, KISS, SOLID, YAGNI,
   SoC) translated into checkable rules and their anti-dogma caveats.
2. [`.agent/rules/01-antipatterns.md`](.agent/rules/01-antipatterns.md) — the
   specific ways AI-written code goes wrong, each with a bad→good example. Scan
   your own diff against this list before finishing.
3. [`.agent/rules/02-project-conventions.md`](.agent/rules/02-project-conventions.md)
   — fuwa specifics: the non-negotiable compiler boundary, Lua style, minimal-JS
   discipline, `.fuwa` parity, contracts, fixtures.
4. [`.agent/rules/03-workflow.md`](.agent/rules/03-workflow.md) — how to work:
   understand first, smallest change, verify, when to stop and ask.

IMPORTANT WRITE COMPREENSIVE UNIT tests for changes

## The short version (the full version is in `.agent/rules/`)

- **Readable code beats clever code, always.** Optimize for the next reader.
- **YAGNI / KISS.** Build what the task needs now. No speculative abstraction,
  factories, config bags, or "just in case" parameters — this is the #1 way AI
  code goes wrong.
- **DRY with the rule of three.** Extract on the third occurrence, not the second.
  A little copying beats the wrong abstraction.
- **Respect the compiler boundary.** `compiler.core` knows nothing about the dev
  server, HTTP, workers, Wasmoon, or the TS host. Data flows
  dev server → `package_web` → `core`, never back. See
  `docs/port-compiler-to-lua.md`.
- **Minimal JavaScript.** Lua is the language. JS is glue. Do not reintroduce a
  Node/JS toolchain into the Lua path.
- **Use petite-vue for petite-vue interactions.** If a shell or tenant
  interaction can be handled cleanly with petite-vue state/directives, prefer
  that over custom JS hooks and delegated DOM state machines.
- **Put petite-vue on the stable parent.** If HTMX swaps a subtree, put
  `v-scope` on the closest ancestor that HTMX does not replace, and keep
  stateful widgets above or explicitly preserved across the swap. Do not mount
  petite-vue state on the node HTMX is about to replace.
- **Report failures through diagnostics**, never a silent empty result. Fail
  loudly.
- **One change, one purpose.** Do not reformat or refactor unrelated code in the
  same edit. Do not add dependencies or APIs that are not already here — if you
  need one, stop and ask.
- **Verify before you claim done**, and report honestly.

These rules override the immediate task when they conflict. If a task requires
breaking them, stop and surface the conflict instead of guessing.
