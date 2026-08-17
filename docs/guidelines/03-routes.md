# 03 — Routes

Routes map an HTTP method and path to an action function. They live in their own
file (usually `app.fuwa`) inside a single `routes do … end` block.

## The shape

From `payloads/current/app.fuwa`:

```
module App

import
  Home "pages/home"
end

routes do
  GET  "/"        Home.index
  POST "/counter" Home.bump
end
```

Each route line is three parts: `METHOD "path" handler`.

- **METHOD** — one of `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
  (`runtime/stdlib/web.lua`).
- **"path"** — a quoted path, optionally with `:param` segments.
- **handler** — a Lua expression that resolves to a function, almost always
  `Alias.action` from an `import`.

The block compiles to a dispatch table (`web.app({ … })`). Anything that is not a
valid `METHOD "path" handler` line is a diagnostic
(`Expected: METHOD "path" handler.function`).

## Path parameters

A segment beginning with `:` captures that part of the path:

```
GET "/users/:id" Users.show
```

`GET /users/42` matches, and inside the action `req.params.id == "42"`. Matching
is exact on segment count — `"/users/:id"` does **not** match `/users/42/edit`
(`match_path` in `runtime/stdlib/web.lua`).

## The `req` object

Every action receives one argument — the request. It is a plain table:

| Field | What it is |
|-------|-----------|
| `req.method` | `"GET"`, `"POST"`, … |
| `req.path` | the path, query string stripped |
| `req.params` | table of `:param` captures, e.g. `{ id = "42" }` |
| `req.query` | parsed `?a=1&b=2` query string |
| `req.form` | parsed form body (`a=1&b=2`), URL-decoded |
| `req.body` | the raw request body string |

`query` and `form` are parsed as `key=value&key=value` and URL-decoded (`+` →
space, `%xx` → byte). Read form fields with `req.form.fieldname`.

## Dispatch and crashes

`app.dispatch(method, path, body)` finds the first route whose method and path
match, then calls the handler with `req`. The call is wrapped in `xpcall`, so a
Lua error inside your action does not take down the server — it becomes a *crash*
response with a traceback, rendered as a readable error box in dev (see
[`08-telemetry-and-debugging.md`](08-telemetry-and-debugging.md)). If no route
matches, dispatch returns a `not_found` response.

## What a handler returns

A handler returns a **response table**, not HTML — produced by `render`,
`redirect`, or `fail`, or a raw HTML string. That is the subject of the next page.
