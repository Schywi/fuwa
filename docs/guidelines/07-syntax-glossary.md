# 07 — Syntax glossary

The whole surface on one page. When you just need "what does `&` / `?` / `->`
mean," start here, then follow the link to the full explanation.

## Sigils and operators

| Token | Where | Means | Example → compiles to |
|-------|-------|-------|-----------------------|
| `&path` | views | Escaped interpolation of a data value | `&title` → HTML-escaped value of `title` |
| `&unsafe path` | views | **Raw** (unescaped) interpolation — trusted markup only | `&unsafe doctype` → literal value of `doctype` |
| `&entity;` | views | HTML entity passthrough | `&amp;` → `&amp;` |
| `?` | actions | Unwrap a Result / non-nil, else `fail` and return | `row = State.create(d)?` → unwrap `.value` or `fail(.err)`/`fail(:not_found)` |
| `->` | actions | "then" in guards and `match` clauses | `if x -> render "a"` → `if x then return render("a",{}) end` |
| `#{expr}` | actions (redirect) | String interpolation inside a quoted target | `redirect "/u/#{id}"` → `redirect("/u/" .. tostring(id))` |
| `:name` | routes | A path parameter | `GET "/u/:id"` → `req.params.id` |
| `:atom` | actions (`fail`) | A symbolic error kind | `fail :not_found` → `fail("not_found")` |
| `key: value` | actions/schemas | A named argument pair | `title: "Hi"` → `title = "Hi"` |

## Block keywords (top level of a file)

| Keyword | Kind | Example |
|---------|------|---------|
| `module Name` | header | `module Home` |
| `use name` | import | `use host` → `local host = require("host")` |
| `import … end` | import block | `import`⏎ `State "models/state"`⏎ `end` |
| `schema "table" do … end` | data | defines a model + table |
| `routes do … end` | routing | the dispatch table |
| `action name(req) do … end` | logic | a request handler function |

Remember: **one block kind per file** — a file is schema *or* routes *or* actions.

## Inside `routes do`

| Form | Means |
|------|-------|
| `GET "/path" Handler.fn` | route a GET (also `POST`, `PUT`, `DELETE`, `PATCH`) |
| `:param` in the path | captured into `req.params` |

## Inside `action … do`

| Form | Means | See |
|------|-------|-----|
| `name = expr` | local assignment | [04](04-actions.md) |
| `name = expr ?` | unwrap-or-fail | [04](04-actions.md) |
| `render "view"[, k: v …]` | render response (auto-`return`) | [04](04-actions.md) |
| `redirect target` | internal GET re-dispatch (auto-`return`) | [04](04-actions.md) |
| `fail :kind` / `fail expr [, k: v]` | failure response (auto-`return`) | [04](04-actions.md) |
| `if COND -> RESULT` | one-line guard / early return | [04](04-actions.md) |
| `match EXPR do / when V -> R / else -> R / end` | branch | [04](04-actions.md) |
| `return expr` | explicit return (needed for raw Lua) | [04](04-actions.md) |

## Inside `schema "…" do`

| Form | Means | See |
|------|-------|-----|
| `field name: type` | a column | [05](05-schemas-and-data.md) |
| `… required` / `… unique` / `… redact` | field flags (metadata) | [05](05-schemas-and-data.md) |
| `… default VALUE` | default when a change omits the field | [05](05-schemas-and-data.md) |
| `timestamps` | add `inserted_at` / `updated_at` | [05](05-schemas-and-data.md) |
| `change Name do / accept … / require … / end` | validated write | [05](05-schemas-and-data.md) |

## View directives (attributes)

| Attribute | Means | See |
|-----------|-------|-----|
| `f-if="path"` / `f-if="not path"` | conditional render | [06](06-views-and-templates.md) |
| `f-for="item in items"` | loop | [06](06-views-and-templates.md) |
| `f-csrf` (on `<form>`) | inject hidden CSRF input | [06](06-views-and-templates.md) |
| `<include src="…"/>` | compile-time file splice | [06](06-views-and-templates.md) |
| `f-key` | **unsupported** (server-rendered, no vdom keys) | [06](06-views-and-templates.md) |

## Two things that surprise people

- **The last response line has no `return`** because `render`/`redirect`/`fail`/
  `if ->`/`match` add it. Raw Lua still needs an explicit `return`.
- **`render "name"` does not load `views/name`.** The app has one compiled view
  tree; the name is a label. Vary output with data and directives.
