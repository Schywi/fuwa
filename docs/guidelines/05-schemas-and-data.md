# 05 — Schemas and data

A `schema` block describes a table's fields and gives you a **model API** —
`find_by`, `create`, `update`, and friends — to call from actions. Each schema
lives in its own file under `models/`.

## The shape

From `payloads/current/models/state.fuwa`:

```
module State

schema "current_state" do
  field key: string required unique
  field count: integer
  field tone: string
end
```

- `schema "table_name" do` — the quoted name is the backing table.
- `field name: type [flags…]` — one column.
- `end` closes the block.

The module name (`State`) is the default model name; the string is the table.

## Fields

```
field name: type [required] [unique] [redact] [default VALUE]
```

- **type** — `string`, `integer`, `boolean`, `datetime`. On write, values are
  coerced by type (`integer` → number, `boolean` → real boolean, else string).
- **required** / **unique** — declared constraints stored as field metadata. They
  describe intent for the storage/repo layer; the active per-request validation
  happens in `change` blocks (below), so treat these as declarations, not
  automatic runtime guards.
- **redact** — marks a field as sensitive. It is recorded as metadata (e.g. so a
  serialization layer can omit it); it is a declaration of intent.
- **default VALUE** — a fallback used when a change accepts the field but no value
  is supplied. Numbers, `true`/`false`, and quoted strings are parsed to their Lua
  values.

## `timestamps`

Add automatic time columns:

```
schema "posts" do
  field title: string required
  timestamps
end
```

`timestamps` adds `inserted_at` and `updated_at` (`datetime`) to the model's
fields.

## `change` blocks — validated writes

A `change` defines a named, whitelisted write with validation:

```
schema "users" do
  field email: string required unique
  field name:  string

  change create do
    accept email, name
    require email
  end
end
```

- **accept** — the only fields taken from the incoming form; everything else is
  ignored. Accepted values are coerced by field type, and a field's `default` is
  applied when the value is missing.
- **require** — fields that must be present and non-empty, or the change is
  invalid.

Calling `Model.change.create(form)` returns a **changeset**:

```lua
{ ok, valid, invalid, data, errors, insert }
```

`data` is the cleaned values, `errors` is a map of field → message, and
`insert()` performs the write (returning a Result). This is the
validate-then-insert flow (`runtime/stdlib/schema.lua`).

## The model API you call from actions

Given a model `State`, these methods are available (`runtime/stdlib/schema.lua`):

| Method | Purpose |
|--------|---------|
| `State.all(opts)` | list rows |
| `State.find(id)` | fetch by id |
| `State.find_by(where, opts)` | fetch by a `{ field = value }` filter |
| `State.where(where, opts)` | list by filter |
| `State.create(data)` | insert (uses `change.create` if defined, else raw insert) |
| `State.update(id, data)` | update by id |
| `State.delete(id)` | delete by id |
| `State.change.<Name>(form)` | build a changeset for a named change |

`create` is smart: if the model defines a `create` change, `State.create(data)`
runs that changeset (whitelist + coerce + validate) and inserts; otherwise it
inserts directly.

## Pairing with `?`

Model writes can return Results (`{ ok = …, value/err }`), which is exactly what
the `?` operator consumes. That is why actions read so cleanly:

```
row = State.create({ key = "main", count = 0, tone = "emerald" })?
count = row.count + 1
row = State.update(row.id, { count = count })?
```

Each `?` unwraps the successful value or short-circuits the action with a
`fail`. No manual `if not ok then …` at every call site. See
[`04-actions.md`](04-actions.md) for the full `?` semantics.

## Where the data actually lives

The model talks to a repo/collection provided by the runtime DB layer
(`runtime/db/`, e.g. the in-memory or local-SQLite provider). As an app author
you use the model API and let the provider handle storage; which provider is
active is a runtime/dev-server concern, not something the schema chooses.
