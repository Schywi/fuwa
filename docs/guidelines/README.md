# `.fuwa` Guidelines

Educational, example-driven documentation for **writing** `.fuwa` apps. If the
docs in `docs/refactoring/` are about how the *engine* is built, these are about
how *you* use it.

Every example here is taken from real code in this repo (mostly
`payloads/current/`), not invented. Where the current behaviour has a rough edge
or a not-yet-built piece, the docs say so plainly rather than pretending.

## What `.fuwa` is, in one paragraph

`.fuwa` is a small DSL that **compiles to Lua**. A `.fuwa` app is a handful of
files — routes, actions, schemas, and views — that the compiler turns into Lua
modules, which the runtime executes to answer a request and return HTML. There is
no server framework and no client SPA framework in the app itself: the server
side is Lua, and the browser side is `htmx` (round-trips) plus `petite-vue` (tiny
local reactivity) plus `UnoCSS` (styling). See
[`docs/refactoring/port-compiler-to-lua.md`](../refactoring/port-compiler-to-lua.md)
for the compiler internals.

## The mental model (read this first)

A request flows through four things:

```
  ROUTE            ACTION                 RESPONSE            VIEW
  "POST /counter"  Home.bump(req)   ->   render "home", …  ->  HTML
  matches a path   runs your logic       a plain table         &-bindings filled in
```

- **Routes** map an HTTP method + path to an action function.
- **Actions** run your logic and return a *response* (`render`, `redirect`, or
  `fail`) — a plain Lua table, not HTML.
- **Views** are HTML templates with `&`-bindings that the runtime fills from the
  response data.
- **Schemas** describe your data and give you a small model API (`find_by`,
  `create`, `update`, …) to call from actions.

## Reading order

1. [`01-mental-model.md`](01-mental-model.md) — files, the request lifecycle, the
   one-file-one-block rule.
2. [`02-modules-and-imports.md`](02-modules-and-imports.md) — `module`, `use`,
   `import … end`.
3. [`03-routes.md`](03-routes.md) — `routes do`, methods, `:params`, the `req`
   object.
4. [`04-actions.md`](04-actions.md) — `action`, the sugar, **why the last line
   needs no `return`**, the `?` operator, `render`/`redirect`/`fail`.
5. [`05-schemas-and-data.md`](05-schemas-and-data.md) — `schema`, `field`,
   `change`, the model API.
6. [`06-views-and-templates.md`](06-views-and-templates.md) — `&`, `&unsafe`,
   `f-if`/`f-for`/`f-csrf`, `<include>`, layout + doctype.
7. [`07-syntax-glossary.md`](07-syntax-glossary.md) — every sigil and keyword on
   one page. Start here when you just want "what does `&` / `?` / `->` mean?"
8. [`08-telemetry-and-debugging.md`](08-telemetry-and-debugging.md) — error
   boxes, diagnostics, tracing, and the current state of logging from an action.

## A whole app at a glance

The real `payloads/current` app is five files:

```text
app.fuwa                     # routes: GET "/" -> Home.index, POST "/counter" -> Home.bump
models/state.fuwa            # schema "current_state": key, count, tone
pages/home.fuwa             # actions: index(req), bump(req)
view.fuwa                    # entry template: <include src="views/layout.fuwa" />
views/layout.fuwa            # the page shell (doctype, <head>, includes home)
views/home.fuwa              # the page body
views/fragments/counter.fuwa # the htmx-swappable counter fragment
```

Each following doc zooms into one of these surfaces.
