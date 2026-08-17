# Plan: First-class fragment rendering (`render "fragments/counter"`)

## Problem

Actions that return an **HTMX partial** (e.g. `Home.bump`, target `#counter`,
`hx-swap="outerHTML"`) cannot use the view system, because the view compiler
only renders a single whole-page template. So `payloads/current/pages/home.fuwa`
hand-builds the counter markup with `table.concat` + `string.format`:

- Duplicates `views/fragments/counter.fuwa` (the two copies have **already
  drifted** — fragment says `kkTone:`, the action string says `Tone:`).
- Bypasses HTML escaping (`string.format` does none; the renderer does).
- No IDE markup support, painful on mobile.

Goal: let an action render a named fragment standalone, so `bump` becomes:

```lua
action bump(req) do
  -- ...db...
  return render "fragments/counter", count: count, tone: tone
end
```

## Why this is small

The view *name* is already threaded through the whole pipeline and simply
ignored at the end:

- `responses.lua:5-22` `parse_render` → emits `render("fragments/counter", {count=..,tone=..})`.
  The regex `^render%s+"([^"]+)"` already accepts a `/` in the name. **No change.**
- `web.lua:17-18` `render(view,data)` → `{_type="render", view=view, data=data}`. **No change.**
- `bootstrap.lua:27-28` → `view.render(resp.view, resp.data or {}, {})` — already passes the name. **No change.**
- `view.lua` (compiled view module, `compile_view_module`) — `M.render(name,data,opts)`
  **ignores `name`** and always renders the one page template. **← the only real change.**

So the entire fix lives in the **view-module compiler**
(`runtime/stdlib/compiler/view.lua`). Turn the single-template module into a
**name-keyed registry** with the page as the default.

## Confirmed facts (anchors)

- Runtime renderer `runtime/stdlib/view.lua`:
  - Signature `M.render(template, data, opts)`; `opts.dev` (default true) turns
    missing bindings into errors.
  - `&field` → `escape_html` (escapes `& < > " '`), lines 41-49, 140-154, 156-205.
  - `&unsafe field` → raw (used for `doctype`), lines 168-182.
  - Directives: `f-for="item in items"` (594), `f-if="path"`/`not path` (410-452),
    `f-csrf` (form only). `<include>` is **compile-time**, handled in
    `compiler/view.lua:expand_includes`, not at runtime.
- Page composition (single template, expanded at compile time):
  `view.fuwa` → `<include layout>` → `<html><head>&title…</head><body><include home></body>`
  → `home.fuwa` `<main><include fragments/counter></main>`.
  Data for the page (`doctype`, `title`, `count`, `tone`) supplied by
  `pages/home.fuwa` action `index` via `render "home", …`.
- View files compile: `init.lua:33-41`:
  - `view.fuwa` → `modules.compile_view_source` → module `view`.
  - `^views/.+%.fuwa$` → `{ lua = nil }` (no standalone module — **keep this**;
    fragments are inlined into the registry as template strings, not Lua modules).
  - `.fuwa` elsewhere → `compile_module_source`.
- `bundle.build` (browser/wasmoon) uses the **same** `package_web.build`
  (`runtime/browser/init.lua:167`), so fragments work identically in browser
  runtime with no extra work.

## Design

Keep exactly one `view` Lua module (so `require("view")` and the
`view.render(name,data,opts)` contract are unchanged), but make it a registry:

```lua
-- generated view module
local view = require("runtime.stdlib.view")
local web  = require("runtime.stdlib.web")
local M = {}

local templates = {
  ["__page__"]          = "<quoted, include-expanded view.fuwa>",
  ["fragments/counter"] = "<quoted, include-expanded views/fragments/counter.fuwa>",
  -- one entry per views/fragments/**.fuwa
}

function M.render(name, data, opts)
  local template = templates[name]
  if template == nil then
    -- Fragment namespace typos must be loud, not silently render the whole page
    -- into an HTMX partial slot.
    if type(name) == "string" and name:match("^fragments/") then
      return web.dev_error_html({
        _type = "error",
        err = { kind = "unknown_fragment",
                message = "No fragment named '" .. tostring(name) .. "'." },
        action = name,
      })
    end
    template = templates["__page__"]   -- back-compat: render "home" etc. → page
  end

  local html, err = view.render(template, data, opts)
  if html ~= nil then return html end
  return web.dev_error_html({
    _type = "error",
    err = { kind = err and err.kind or "template_error",
            message = err and err.message or "Template render failed" },
    action = name,
    line = err and err.line or nil,
    expr = err and err.snippet or nil,
  })
end

return M
```

### Naming rule

- `view.fuwa` → the page, key `__page__` (and the default fallback).
- Only `views/fragments/**.fuwa` are registered as fragments, keyed by the path
  relative to `views/`, minus extension: `views/fragments/counter.fuwa` →
  `"fragments/counter"`.
- `views/layout.fuwa`, `views/home.fuwa` stay structural (used via `<include>`,
  not registered) — they are not standalone-renderable (no `<html>` wrapper).

### Back-compat

Every existing `render "X"` still renders the page (no fragment is named `X`
unless `X` starts with `fragments/`). `index`'s `render "home", …` is unchanged.
The page template still inlines the counter via `<include>`, so full-page render
is untouched — the fragment registry entry is a *separate* compile of the same
source file, giving one source of truth.

## Change set

1. **`runtime/stdlib/compiler/view.lua` — `compile_view_module`** (the only core change)
   - Currently: expands includes for one `template_source`, emits a single-template module.
   - New: it already receives `source_files`. Additionally:
     a. Expand the page template (`view.fuwa` source) → `__page__` (as today).
     b. Scan `source_files` for keys matching `^views/fragments/.+%.fuwa$`;
        for each, run `expand_includes` (reuse existing, handles nested includes +
        cycle detection) and register under its `fragments/<name>` key.
     c. Emit the registry module shown above.
   - Aggregate diagnostics from **every** template's include-expansion into the
     returned `diagnostics` list (missing include / recursion per fragment).
   - `strings.quote_lua_string` each expanded template (as today).

2. **`runtime/stdlib/compiler/init.lua`** — likely **no change**. `view.fuwa`
   still routes to `compile_view_source` with `source_files`; the `views/**`
   branch still returns `{ lua = nil }` (fragments are inlined as strings, not
   emitted as Lua modules). Confirm `compile_view_source` forwards `source_files`
   through to `compile_view_module` (it does: `modules.lua:121-122`).

3. **`payloads/current/pages/home.fuwa`** — replace the `bump` `table.concat`
   block (lines 22-33) with:
   ```lua
   return render "fragments/counter", count: count, tone: tone
   ```

4. **`payloads/current/views/fragments/counter.fuwa`** — fix the `kkTone:` typo
   → `Tone:` (now the single source for both the page include and `bump`).

No changes to `responses.lua`, `web.lua`, `bootstrap.lua`, `package_web.lua`,
`runtime/stdlib/view.lua`, or the browser worker.

## Edge cases / risks

- **Silent page fallback footgun** — handled: a `fragments/*` name that isn't
  found returns a dev error, not the whole page injected into `#counter`.
- **Data contract** — fragment gets a flat data table; `counter.fuwa` reads
  `&count`, `&tone`; `bump` passes `{count, tone}`. `bg-&tone-500` works because
  `read_token` stops at `-` (`view.lua:117-133`), yielding `bg-` + esc(tone) + `-500`.
- **Escaping** — `&count`/`&tone` auto-escape via `escape_html`; keep `&unsafe`
  only for genuinely-raw values (doctype). The old `string.format` hole is removed.
- **Browser/wasmoon parity** — none needed; same `package_web.build` feeds the
  bundle, so the registry ships to the worker automatically.

## Test checklist

- `render "fragments/counter", count: 3, tone: "amber"` returns **only**
  `<section id="counter">…</section>` (no `<html>`), with escaped values and
  `class="… bg-amber-500 …"`.
- Full page `render "home", …` still renders `<html>` + inlined counter (regression).
- Unknown `render "fragments/nope"` → dev error, not a page.
- A fragment that `<include>`s another fragment expands correctly; a recursive
  include reports a diagnostic.
- Check `tests/` for existing view-render coverage and add the above.

## Optional sugar (not required)

- A bare-name or `render_fragment "counter"` alias could map to
  `fragments/counter` — a tiny `responses.lua` addition. Skip for the first cut;
  `render "fragments/counter"` needs zero parser work.
- Do **not** build the `H[[...]]` interpolation sigil — it reintroduces a second,
  weaker templating language when `.fuwa` views already are the template language.
