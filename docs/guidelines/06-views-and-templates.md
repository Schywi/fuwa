# 06 — Views and templates

Views are HTML files with a few extra powers: `&`-bindings to inject data,
`f-*` directives for conditionals and loops, and `<include>` to compose files.
The runtime renderer is deliberately tiny (`runtime/stdlib/view.lua`).

## `&` — the binding sigil

`&` is how you put data into HTML. It has three modes.

### `&path` — escaped interpolation (the default)

```
<h1>&title</h1>
<span class="counter-pill">Clicks: &count</span>
```

`&title` looks up `title` in the render data and inserts it **HTML-escaped**
(`<`, `>`, `&`, quotes are neutralized). `&` reads a dotted path, so `&user.name`
walks into nested tables. This is the safe default — use it for anything that
came from data.

Bindings work **inside attribute values** too:

```
<section class="counter-card bg-&tone-500 text-white">
```

Here `&tone` is replaced, producing `bg-emerald-500`.

### `&unsafe path` — raw, unescaped

```
&unsafe doctype
```

`&unsafe` inserts the value **without escaping**. Use it only for trusted markup
you intend to emit literally (a doctype, pre-rendered HTML). Never point
`&unsafe` at user input — that is an injection hole. Note the space: it is
`&unsafe <path>`, e.g. `&unsafe body_html`.

### `&entity;` — HTML entities pass through

Named or numeric HTML entities are left alone: `&amp;`, `&nbsp;`, `&#39;` render
as themselves. A lone `&` that is not a binding or an entity becomes a literal
`&amp;`. So you rarely have to think about escaping the ampersand yourself.

## The doctype pattern (and the fragment gotcha)

`views/layout.fuwa` begins with:

```
&unsafe doctype
<html>
  ...
```

The `doctype` value is supplied by the action's render data:

```
render "home", doctype: "<!DOCTYPE html>", title: "Fuwa Dev", ...
```

This keeps the doctype out of the template literal and lets a **fragment** render
of the *same* template omit it by passing `doctype: ""`. If you build a fragment
action against a template that starts with `&unsafe doctype`, remember to pass
`doctype: ""`, or you will get a missing-binding error in dev.

## Directives: `f-if`, `f-for`, `f-csrf`

These are special attributes the renderer interprets and strips.

### `f-if` — conditional rendering

```
<p f-if="published">Live</p>
<p f-if="not draft">Ready</p>
```

The condition is a bare path or `not path` — truthiness of the value. Anything
more complex is rejected (`Unsupported f-if condition`). Do computation in the
action and expose a boolean; keep the template dumb.

### `f-for` — loops

```
<li f-for="item in items">&item.label</li>
```

`f-for="var in path"` iterates a list, binding `var` for the element's subtree.
You can combine it with `f-if` on the same element to filter per item. (List keys
— `f-key` — are intentionally **not** supported; this is server-rendered HTML, not
a client vdom.)

### `f-csrf` — CSRF token on forms

```
<form method="post" hx-post="/save" f-csrf>
  ...
</form>
```

`f-csrf` may only appear on a `<form>`. It injects a hidden
`<input name="_csrf">` with the request's token. Anywhere else it is an error.

## `<include>` — compile-time composition

```
<include src="views/fragments/counter.fuwa" />
```

`<include>` splices another view file in **at compile time**. It is expanded by
the compiler before rendering, is recursion-guarded, and errors if the target is
missing. It matches exactly one shape — `<include src="..."/>` — and nothing else.

**Phase rule you must respect:** `<include>` is compile-time; `f-if`/`f-for` are
runtime. Do **not** put a runtime directive on an `<include>` (e.g.
`<include src="…" f-if="fragment" />`). The compiler won't recognize the decorated
tag, so it won't expand it, and the renderer will print the literal `<include>`
tag as text. To choose between full-page and fragment output, decide **in the
action** which to render — do not conditionalize the macro. This is codified in
[`.agent/rules/02-project-conventions.md`](../../.agent/rules/02-project-conventions.md)
("Compile-time vs runtime composition").

## The entry template and how a page is assembled

`view.fuwa` is the app's entry template. In the real app it is one line:

```
<include src="views/layout.fuwa" />
```

`layout.fuwa` provides the document shell (`<html>`, `<head>`, styles) and
includes the page body (`views/home.fuwa`), which in turn includes the counter
fragment. So the whole page is one tree assembled from includes at compile time,
then filled with `&`-bindings at render time.

Note the current limitation from [`04-actions.md`](04-actions.md): the compiled
app has **one** view tree. `render "name"` selects data, not a template file; the
name is a label used in error messages. Vary pages through data and `f-if`, or
compose fragments, rather than expecting `render "x"` to load `views/x`.

## petite-vue and htmx attributes pass straight through

The SSR renderer does not interpret client attributes — `v-scope`, `@click`,
`:class`, `hx-post`, `hx-target`, `hx-swap` are emitted verbatim for the browser
to act on:

```
<button
  hx-post="counter" hx-target="#counter" hx-swap="outerHTML"
  @click="pressed = !pressed"
  :class="pressed ? 'scale-95 ring-2' : ''">
  Ping the stack
</button>
```

The division of labor: **the server** fills `&`-bindings and returns HTML;
**htmx** does the round-trip and swap; **petite-vue** handles small local state
(`pressed`). Keep server data in `&`-bindings and ephemeral UI state in
petite-vue.

## Missing bindings

In **dev** (the default), a binding whose path is missing raises a readable
`Missing value for binding` error instead of silently rendering nothing. In
production mode a missing binding renders as empty. This is why fragment renders
must pass every binding the template references (like `doctype: ""`). See
[`08-telemetry-and-debugging.md`](08-telemetry-and-debugging.md).
