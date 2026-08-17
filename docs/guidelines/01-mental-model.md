# 01 — The mental model

Before syntax, the shape. A `.fuwa` app is files that compile to Lua and answer
requests with HTML. This page explains how the pieces fit and the one structural
rule that trips people up.

## The request lifecycle, end to end

Take `POST /counter` in the real app:

1. **The dev server** receives the request and (re)compiles the payload files to
   Lua (`runtime/fuwa-dev.lua` → `package_web.build`).
2. **`main.lua`** (generated for you) calls `app.dispatch("POST", "/counter", body)`.
3. **The route table** (`app.fuwa`) matches `POST "/counter"` to `Home.bump`.
4. **The action** `Home.bump(req)` runs your logic and returns a *response table*
   — here, a raw HTML string; elsewhere, `render "home", …`.
5. **`main.lua`** turns the response into HTML: a `render` response is passed to
   the compiled view module, which fills `&`-bindings from the response data.
6. **The HTML** goes back to the browser. `htmx` swaps it in; `petite-vue`
   handles any local reactivity.

The key idea: **actions return data, not HTML.** The `render`/`redirect`/`fail`
values are plain Lua tables (`{ _type = "render", … }`). Turning them into HTML is
the runtime's job, not yours.

## The four surfaces

| Surface | File(s) | Block keyword | Produces |
|---------|---------|---------------|----------|
| Routes  | `app.fuwa` | `routes do` | a dispatch table |
| Actions | `pages/*.fuwa` | `action name(req) do` | response tables |
| Schemas | `models/*.fuwa` | `schema "table" do` | a model API |
| Views   | `view.fuwa`, `views/*.fuwa` | *(HTML, no block)* | HTML |

## The one rule that trips people up: one block kind per file

A single `.fuwa` module file may contain **only one kind of block** — either
`schema`, or `routes`, or `action`s (one or more). Mixing them is a hard compile
error:

```
Mixed block types are not supported in one file
```

(See `runtime/stdlib/compiler/modules.lua`.) So:

- routes live in their own file (`app.fuwa`),
- a model's schema lives in its own file (`models/state.fuwa`),
- actions for a page live together in one file (`pages/home.fuwa`), and you can
  have several `action` blocks in that one file.

Views are different — they are HTML templates, not block modules, and follow the
rules in [`06-views-and-templates.md`](06-views-and-templates.md).

## How files become Lua (so the layering makes sense)

- Each `.fuwa` module compiles to a Lua module named by its path: `models/state`
  → `require("models.state")`, referenced in `.fuwa` via `import`/`use`.
- `view.fuwa` compiles to a single `view` module whose `render(...)` fills the
  template.
- The compiler synthesizes `main.lua` (the `handle_request` entrypoint) — you
  never write it.

You do not need to read the generated Lua to be productive, but knowing it exists
explains the rules: for example, a `.fuwa` name maps to a Lua `require` path, so
paths use `/` and become `.` under the hood (see
[`02-modules-and-imports.md`](02-modules-and-imports.md)).

## Where your app runs

Today the app runs server-side under the Lua dev server, which returns HTML over
HTTP. The larger architecture (browser Web Worker, sandboxed iframe, host shell)
is described in `docs/refactoring/shell-architecture.md`; you do not need it to
write app logic. What matters here: **actions are plain functions of `req` that
return response tables, and views are HTML with `&`-bindings.** Everything else is
detail.
