# 08 — Telemetry and debugging

How to see what your app is doing when it misbehaves — and an honest account of
what logging from inside an action does and does not do today.

## The dev error boxes

When something goes wrong in dev, you get a readable HTML box instead of a blank
page or a raw stack trace, rendered by `web.dev_error_html`
(`runtime/stdlib/web.lua`). Two kinds:

- **Action error** — a `fail(...)` you returned, or a `?` that short-circuited.
  Shows the `action`, `line`, `expr`, error `kind`, and `message`.
- **Lua crash** — an uncaught Lua error inside an action. Dispatch wraps handlers
  in `xpcall`, so a crash becomes a `crash` response carrying a traceback, shown
  in the box rather than killing the server.

So a broken action degrades to a labeled error panel, not a dead tab.

## Missing-binding errors

In dev (the default render mode), referencing a data path the template does not
have raises `Missing value for binding \`path\`` with the line and snippet, instead
of silently rendering empty. This is your early warning that an action forgot to
pass a value — for example a fragment render that reuses a template starting with
`&unsafe doctype` but omits `doctype: ""`. In production mode, a missing binding
renders as empty instead of erroring. See
[`06-views-and-templates.md`](06-views-and-templates.md).

## Compile diagnostics

Before anything runs, the compiler collects diagnostics
(`{ level, file, line, message }`). On a compile error the dev server returns the
formatted diagnostics as plain-text HTTP 500 — so a syntax mistake shows you the
file, line, and what was expected (e.g.
`Expected: METHOD "path" handler.function`), not a mysterious runtime failure.

## Runtime tracing (`FUWA_TRACE`)

The runtime has span-based tracing (`runtime/trace.lua`, used from
`runtime/fuwa-dev.lua` and the DB layer). It is opt-in via an environment
variable and writes to stderr:

```sh
FUWA_TRACE=1 ./dev.sh          # all spans
FUWA_TRACE=db,request ./dev.sh # only these scopes (prefix match)
```

You get a correlated, timed picture per request — the `request` span, the
`render` span, DB dispatch, and so on. This is the tool for "where is the time
going / which layer failed." The full design and rationale live in
[`docs/refactoring/telemetry-plan.md`](../refactoring/telemetry-plan.md).

## Logging from inside a `.fuwa` action — the honest state

**Today you cannot idiomatically log from an action.** An action's scope is set
up with only the response builders — `render`, `redirect`, `fail` (plus `web`).
There is no `log` or `trace` handle injected into action code
(`runtime/stdlib/compiler/actions.lua`). Tracing currently lives at the
**runtime/dev-server layer**, not the DSL.

What this means in practice:

- To observe a request end to end, use `FUWA_TRACE` and read the runtime spans.
- The planned path for app-level logging is the **`log` builtin** described in
  `telemetry-plan.md` (phase 2): a `log "message"` form in `.fuwa` that lowers to
  a trace call. Until that lands, there is no blessed in-action logging API.
- Avoid reaching for `print` in an action as a workaround — output handling is a
  runtime concern and `print` is not wired to the response or the trace sink. If
  you need visibility now, add or extend a span at the runtime layer, or lean on
  the error boxes and `FUWA_TRACE`.

This gap is deliberate and tracked, not an oversight — logging is being designed
as a proper span/telemetry surface rather than scattered `print`s. See
`telemetry-plan.md` for the shape it will take.

## A quick debugging checklist

1. **Blank or wrong output?** Check the dev error box and the
   missing-binding message.
2. **`<include>` printing literally?** You put a runtime directive on a
   compile-time macro — see the phase rule in
   [`06-views-and-templates.md`](06-views-and-templates.md).
3. **Action failing unexpectedly?** A `?` probably short-circuited on a `nil` or
   an error Result — check what the model call returned.
4. **Need timing / which layer?** `FUWA_TRACE=1` and read the spans.
5. **Compile error?** Read the HTTP 500 diagnostics — file, line, expectation.
