# ESM And Payload Refactoring Plans

This folder captures the two separate refactors that came out of the August 1,
2026 review of the codebase:

1. The shell/IDE-side JavaScript hooks are doing real browser-host work, but
   their loading model is still a hybrid of globals, classic scripts, dynamic
   imports, and classic workers.
2. Some payloads, especially `fuwa-gomen`, put too much product logic in
   browser JavaScript instead of keeping the app easy to read in `.fuwa` and
   Lua.

These are related, but they are not the same problem.

- The shell/hooks refactor is about better module boundaries and native browser
  loading.
- The payload refactor is about reducing application logic in JS, even if some
  JS remains for animation and browser-only glue.

This folder deliberately keeps those plans separate so they do not get mixed
into one oversized rewrite.

## Files

- [01-shell-hooks-native-esm-plan.md](./01-shell-hooks-native-esm-plan.md)
  Native ESM migration plan for shell/IDE/browser-host JS.
- [02-fuwa-gomen-payload-lua-port-plan.md](./02-fuwa-gomen-payload-lua-port-plan.md)
  Payload-focused plan to shrink JS ownership and move `fuwa-gomen` logic back
  into `.fuwa` and Lua.

## Core principles

- Lua remains the main language.
- JS remains glue, not the app brain.
- Native ESM is allowed and desirable where browser-host JS is genuinely needed.
- The compiler boundary must not be touched by either refactor.
- The live Wasmoon/browser runtime and the deployed OpenResty runtime must keep
  the same visible app behavior.

## Status tags

- `FUWAGOMENREFACTOR:postponed`
  The payload plan is intentionally documented now and can be executed later in
  small pieces.

## Decision summary

- Use native browser ESM more aggressively in `shell/hooks` and adjacent
  browser-owned code.
- Do **not** use "switch to ESM" as an excuse to keep app logic in JS.
- Reduce payload JS by moving business rules, derived state, and action
  semantics into `.fuwa`/Lua first.
- Keep only browser-only concerns in payload JS:
  animation, DOM-only effects, and minimal mount/bootstrap glue.
