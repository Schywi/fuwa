# 02 — Modules and imports

Every `.fuwa` file is a **module**. This page covers the three ways files declare
and pull in other code: the `module` header, `use`, and `import … end`.

## `module` — naming the file

A file usually opens with a `module` header:

```
module Home
```

It names the module. For a schema file it also becomes the default model name
(see [`05-schemas-and-data.md`](05-schemas-and-data.md)). It is a label; it does
not change where the file lives or how it is required.

## `import … end` — bringing in other modules with an alias

`import` blocks map a local alias to another module's path:

```
import
  State "models/state"
  Home  "pages/home"
end
```

Compiles to:

```lua
local State = require("models.state")
local Home  = require("pages.home")
```

Rules:

- The path is written with **slashes** and is relative to the app root; the
  compiler converts `/` to `.` for the Lua `require` path
  (`models/state` → `models.state`). See
  `runtime/stdlib/compiler/strings.lua` (`module_path_to_require_path`).
- The alias is what you use in code: `State.find_by(...)`, `Home.index`.
- The block ends with `end`. Each line must be exactly `Alias "path"`; anything
  else is a diagnostic (`Expected: Alias "path/to/module"`).

Use `import` when you need a **named handle** to another module — models you call,
pages whose actions you route to.

## `use` — pulling in a capability or module by bare name

```
use host
```

Compiles to:

```lua
local host = require("host")
```

Differences from `import`:

- `use` takes a **bare lowercase name**, not a quoted path, and the local name is
  that same name.
- It is de-duplicated: writing `use host` twice emits the `require` once.

`use` is how the host shell reaches a **privileged capability** like `host`
(provided by the runtime only in the host, never to a sandboxed payload — see
`docs/refactoring/shell-architecture.md`). The compiler does not treat `use host`
specially; it is an ordinary `require`, and whether it resolves is decided at
runtime by whether the runtime registered that module. In a tenant payload,
`use host` simply fails to resolve — that is the sandbox.

## Which one do I use?

| You want… | Use |
|-----------|-----|
| A model or page module, referenced by a name | `import Alias "path"` |
| A runtime-provided capability (`host`) | `use name` |
| To label the current file | `module Name` |

## A complete header

From `payloads/current/pages/home.fuwa`:

```
module Home

import
  State "models/state"
end
```

That is the whole preamble: name the module, import the model it needs, then the
`action` blocks follow (next page).
