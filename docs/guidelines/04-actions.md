# 04 — Actions

Actions are where your logic lives. This is the richest part of `.fuwa`, because
the compiler adds a layer of **sugar** on top of plain Lua. Understand the sugar
and everything else clicks — including the two questions everyone asks: *why is
there no `return` on the last line?* and *what does `?` do?*

## What an action is

```
action index(req) do
  ...
end
```

An `action name(req) do … end` block compiles to a Lua function `M.name(req)` on
the module's table. A single file can hold several actions (all sharing one
`local M = {}` and a trailing `return M`, generated for you). The argument is the
request object from [`03-routes.md`](03-routes.md); the name `req` is just a
parameter name — call it what you like.

An action **returns a response**: `render`, `redirect`, `fail`, or a raw HTML
string. It returns *data describing what to do*, never HTML directly (except the
raw-string escape hatch).

## Why the last line needs no `return`

Because the compiler adds it for you. When a line starts with `render`,
`redirect`, or `fail`, the sugar rewrites it as a `return`:

```
render "home", title: "Fuwa Dev", count: row.count
```

compiles to:

```lua
return render("home", { title = "Fuwa Dev", count = row.count })
```

Same for `redirect …`, `fail …`, the `if … -> …` guard, and `match`. So the
terminal response reads like a statement, not a `return`.

**But this is sugar for those forms only.** A line of **plain Lua still needs its
own `return`.** That is exactly why `Home.bump` ends with an explicit one:

```
  return table.concat({
    ... html lines ...
  }, "\n")
```

Rule of thumb: `render`/`redirect`/`fail`/`if ->`/`match` return themselves; raw
Lua does not.

## The `?` operator — unwrap or fail

`?` is the single most useful piece of action sugar. A trailing `?` on an
assignment means **"unwrap this, or bail out with a failure."** From the real
app:

```
row = row or State.create({ key = "main", count = 0, tone = "emerald" })?
```

Given `name = expr ?`, the compiler evaluates `expr` once and then
(`runtime/stdlib/compiler/actions.lua`, powered by `runtime/stdlib/result.lua`):

- if it is **`nil`** → the action returns `fail({ kind = "not_found" })`;
- if it is a **Result** (a table with an `.ok` field):
  - `{ ok = true, value = v }` → `name` becomes `v`;
  - `{ ok = false, err = e }` → the action returns `fail(e)`;
- otherwise (a plain value) → `name` becomes that value as-is.

It is Rust's `?` for the tiny Result type: the happy path stays flat, and the
error path short-circuits out of the action. Model methods like `create`/`update`
can return Results, which is why they pair naturally with `?`
(see [`05-schemas-and-data.md`](05-schemas-and-data.md)).

## The response builders

### `render`

```
render "home"
render "home", title: "Fuwa Dev", count: row.count, tone: row.tone or "emerald"
```

- The first argument is a view name; the rest are `key: value` pairs that become
  the data table.
- **Values are plain Lua expressions** — `row.count`, `row.tone or "emerald"` are
  evaluated, not treated as strings.
- The view name is currently a **label**, not a template selector: the app has one
  compiled view tree (`view.fuwa`), and `render "home"` vs `render "x"` render the
  same tree with your data. The name shows up in error reporting. Differentiate
  pages with data and template directives, not the render name. (This is a current
  limitation, documented honestly — see
  [`06-views-and-templates.md`](06-views-and-templates.md).)

### `redirect`

```
redirect "/"
redirect "/users/#{id}"
```

- `#{expr}` inside the quoted target is string interpolation: `"/users/#{id}"`
  becomes `"/users/" .. tostring(id)`.
- **Important semantic:** a redirect is an *internal GET re-dispatch*, not an HTTP
  302. The runtime immediately dispatches `GET <target>` and returns *its* HTML,
  guarded against loops (depth 8). So redirect means "render what that route would
  render," in-process.

### `fail`

```
fail :not_found
fail :invalid, message: "bad input"
fail err
```

- `fail :atom[, key: value…]` fails with a symbolic kind and optional metadata.
- `fail expr[, key: value…]` fails with an error value you already have.
- A failure renders as an error box in dev (see
  [`08-telemetry-and-debugging.md`](08-telemetry-and-debugging.md)).

## Guards: `if COND -> RESULT`

A one-line conditional early-return:

```
if req.form.name == "" -> fail :invalid, message: "name required"
```

compiles to:

```lua
if req.form.name == "" then
  return fail("invalid", { message = "name required" })
end
```

The right-hand side can be any response (`render`/`redirect`/`fail`) or a plain
expression. Use it for validation and early exits.

## Branching: `match … do`

```
match role do
  when "admin" -> render "admin_home"
  when "user"  -> render "home"
  else         -> fail :forbidden
end
```

Each `when VALUE -> RESULT` compiles to an `if/elseif` comparing the match
expression to the value and returning the result; `else -> RESULT` is the
fallthrough. Values are compared with `==`.

## Plain Lua is always available

Anything that is not one of the sugar forms passes through as Lua. You can call
functions, build strings, use `local`s (`name = expr` becomes
`local name = expr`), loop, and `return` explicitly. The sugar is a convenience on
top of Lua, never a cage.

## A full action, annotated

```
action bump(req) do
  row = State.find_by({ key = "main" })                         -- plain: local row = …
  row = row or State.create({ key = "main", count = 0 })?       -- ? : unwrap or fail

  count = row.count + 1                                          -- plain local
  tone  = count % 2 == 0 and "emerald" or "amber"               -- plain local
  row = State.update(row.id, { count = count, tone = tone })?   -- ? again

  return table.concat({ ... }, "\n")                            -- raw Lua: explicit return
end
```

Sugar where it helps (`?`), plain Lua where you need control (the explicit
`return`). That mix is idiomatic `.fuwa`.
