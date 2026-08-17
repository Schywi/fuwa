# Implementation Plan: Split Views, Interaction Proof, and Database Providers

Location: everything in this plan is implemented in **this repo**
(`/mnt/DATA/development/projects/repos/fuwa`).

This document is the next-step plan now that the native Lua dev server works.
It is grounded on what already exists here and on the database behavior already
proven in the old IDE runtime.

## What We Have Right Now

The current repo already has the critical base pieces:

- a native Lua dev server in [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:1)
- a canonical runtime tree in [runtime/stdlib](/mnt/DATA/development/projects/repos/fuwa/runtime/stdlib)
- a ported compiler under [runtime/stdlib/compiler](/mnt/DATA/development/projects/repos/fuwa/runtime/stdlib/compiler)
- a current payload in [payloads/current](/mnt/DATA/development/projects/repos/fuwa/payloads/current)
- compiler/unit smoke tests under [tests](/mnt/DATA/development/projects/repos/fuwa/tests)

The current payload is still minimal:

- [payloads/current/app.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/app.fuwa:1)
- [payloads/current/pages/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/pages/home.fuwa:1)
- [payloads/current/view.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/view.fuwa:1)

That is good. It means the next work should focus on proving boundaries rather
than expanding complexity.

## The Four Things We Need To Prove

The next milestone is not "more features." It is proof that the architecture is
holding.

We need to prove:

1. views can be split into smaller files
2. HTMX, petite-vue, and UnoCSS all work together in the current payload
3. the DB layer can run against more than one provider
4. `payload/` and IDE/UI concerns remain separate

If these four hold, the repo is moving toward a real Lua-first `.fuwa` system
instead of another host-coupled prototype.

## Current Architectural Boundary We Must Preserve

This distinction is now a rule, not a preference.

### `payload/` owns app content

`payloads/current/` is where `.fuwa` apps live.

It should own:

- routes
- actions
- models
- views
- fragments
- client hooks that belong to the tenant app
- curated content / lessons / app behavior

It should not own:

- editor chrome
- file explorers
- IDE panels
- host preview orchestration
- authoring controls

### `ui/` owns IDE tooling

Even if the IDE host is later rewritten in `.fuwa`, that is still a separate
concern from the payload app itself.

The host/editor side should own:

- edit panels
- preview frame host
- file tree
- authoring tools
- shell chrome
- developer tooling

That separation must stay explicit in the folder structure and in the runtime
contracts.

## Phase 1: Split the Current View Into Smaller Files

This is the first real compiler/runtime proof.

Right now the payload still uses one [view.fuwa](/mnt/DATA/development/projects/repos/fuwa/payloads/current/view.fuwa:1).
That is fine for bootstrapping, but not enough for a serious app model.

### Goal

Prove that one rendered screen can be composed from multiple smaller files
without reintroducing a JS-owned view layer.

### Desired outcome

Move from:

```text
payloads/current/
  view.fuwa
```

to something like:

```text
payloads/current/
  views/
    layout.fuwa
    home.fuwa
    fragments/
      controls.fuwa
      status.fuwa
```

The exact syntax is still open, but the test must prove:

- a shared shell/layout works
- content can be split into sub-files
- data still flows correctly
- interactive fragments can be isolated

### Minimal implementation scope

Do not redesign the DSL here. Keep this as narrow as possible.

The MVP split-view feature should support only:

- one layout file
- one page body file
- one or two fragment includes

Possible implementation directions:

1. add a simple include/partial primitive to `view.fuwa`
2. allow the compiler to compile a small `views/` tree
3. keep a single render entrypoint but compose from referenced fragments

The best MVP is the smallest one that proves composition works.

### Acceptance criteria

- the current payload still renders after being split
- at least one fragment receives dynamic data
- one interactive fragment can be edited independently
- no host-side JS is needed to glue the split files together

## Phase 2: Add One Deliberate Interaction Test To the Current Payload

We need one small feature that proves the client stack works end-to-end.

The point is not the feature itself. The point is proving:

- HTMX request flow
- petite-vue local state
- UnoCSS styling

### Recommended test

Add one button in the current payload that:

1. triggers an HTMX request
2. mutates some state on the server side
3. returns updated HTML
4. visibly changes styling
5. uses petite-vue for a tiny local-only effect

### Good example

A compact test could be:

- a "Feed" / "Ping" / "Toggle mood" button
- HTMX posts to an action
- action updates a record or counter
- returned fragment changes label, count, and status class
- petite-vue handles a tiny transient state like:
  - optimistic pressed state
  - pulse animation class toggle
  - local tooltip visibility

### Why this is the right test

It proves all three client pieces without needing a large demo:

- HTMX proves request/response wiring
- UnoCSS proves the styling pipeline exists and applies correctly
- petite-vue proves local reactivity still has a place, but only a small one

### Acceptance criteria

- clicking the button causes a real request
- returned HTML visibly updates
- UnoCSS classes affect the result
- petite-vue behavior works without owning the whole screen

## Phase 3: Introduce a Real DB Provider Boundary

This is the most important runtime change after split views.

The goal is not "add SQLite." The goal is:

- define a stable persistence contract
- make the payload use that contract
- allow multiple backends behind it

This should look more like a Drizzle-style provider boundary than a one-off
embedded storage hack.

## The DB Contract We Already Have

This is where we should be strict: do not invent a new DB surface unless
absolutely necessary.

The current Lua-facing API already exists in
[runtime/stdlib/db.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/stdlib/db.lua:1).

The payload-facing collection API is:

- `Db.collection(name).all(opts?)`
- `Db.collection(name).find(id)`
- `Db.collection(name).find_by(where, opts?)`
- `Db.collection(name).where(where, opts?)`
- `Db.collection(name).create(data)`
- `Db.collection(name).insert(data)`
- `Db.collection(name).update(id, data)`
- `Db.collection(name).delete(id)`

Internally, that runtime expects a host bridge:

- global `__fuwa_db_op(command)`
- returns a value with `:await()`
- resolves to either:
  - `{ ok = true, value = ... }`
  - `{ ok = false, err = { kind, message, meta? } }`

That is already a decent boundary. Keep it.

## Grounding the Provider Design on the Old IDE Database

The old IDE runtime in
[/mnt/DATA/development/projects/repos/IDE/src/engine/sqlite.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/sqlite.ts:1)
already defines the command semantics we should preserve.

### Existing command set

The command operations are:

- `all`
- `find`
- `find_by`
- `where`
- `create`
- `update`
- `delete`

### Existing response/error model

The old runtime returns:

- `ok(value)`
- `err(kind, message, meta?)`

Important error kinds already in use:

- `not_found`
- `already_exists`
- `invalid_command`
- `db_error`

These should remain stable across providers.

### Existing behavioral semantics worth keeping

From the old IDE SQLite layer:

- collection names are sanitized
- reserved fields are stripped from input:
  - `id`
  - `created_at`
  - `updated_at`
- rows expose:
  - `id`
  - payload fields
  - `created_at`
  - `updated_at`
- `find_by` returns the first matching row
- `where` and `all` support:
  - `limit`
  - `order`
- default ordering is effectively by `updated_at desc`
- `create` returns `already_exists` when `id` collides
- `update` and `delete` return `not_found` when missing

These are the semantics we should carry into the `fuwa` providers, even if the
storage implementation changes.

## Provider Strategy

We should implement providers behind the existing command boundary, not by
rewriting the Lua-facing API.

### Target providers

1. `memory`
2. `sqlite-local`
3. later: `sqlite-wasm`

### Why this order

- `memory` is fastest to implement and test
- `sqlite-local` gives realistic persistence in native Lua dev
- `sqlite-wasm` can come later when the browser runtime needs parity

### Important rule

The payload should not know which provider is active.

The provider decision belongs to the host/runtime layer, most likely in
[runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:1).

## Recommended Provider Layout

Add a provider subtree under `runtime/`:

```text
runtime/
  fuwa-dev.lua
  db/
    init.lua
    provider.lua
    providers/
      memory.lua
      sqlite_local.lua
```

### Responsibilities

- `runtime/db/provider.lua`
  - common helper logic
  - result helpers
  - validation shared by providers

- `runtime/db/providers/memory.lua`
  - in-memory collection storage
  - best for tests

- `runtime/db/providers/sqlite_local.lua`
  - native local SQLite implementation
  - persists across requests

- `runtime/db/init.lua`
  - selects provider
  - exposes `db_op(command)`

Then `fuwa-dev.lua` defines:

- `__fuwa_db_op(command)` -> wrapper around selected provider

That keeps `runtime/stdlib/db.lua` unchanged.

## Important MVP Decision: Flat File vs Local SQLite

Today `fuwa-dev.lua` already carries flat-file state machinery.

That means we have two realistic near-term options:

1. keep the flat-file store briefly as the temporary `memory-ish`/bootstrap provider
2. move directly to a true `memory` provider plus a separate `sqlite-local` provider

Recommendation:

- keep the existing flat-file-backed path only long enough to avoid breaking the
  current working server
- introduce a real provider boundary immediately
- implement `memory` first
- then replace the flat-file path with `sqlite-local`

Do not let the current flat-file state shape become the long-term DB design.

## Phase 4: Implement the Memory Provider

This provider is for:

- fast local tests
- deterministic behavior
- proving the command contract

### Scope

Implement the full command set:

- `all`
- `find`
- `find_by`
- `where`
- `create`
- `update`
- `delete`

with the same semantics as the old IDE SQLite layer.

### Data model

Use a simple structure like:

```lua
state = {
  collections = {
    wallets = {
      ["id-1"] = { id = "...", created_at = "...", updated_at = "...", ... },
    }
  }
}
```

### Tests

Add provider tests covering:

- create/find round trip
- duplicate id collision
- update missing row
- delete missing row
- `where` filtering
- `find_by` first match behavior
- ordering and limit

## Phase 5: Implement the Local SQLite Provider

This provider is for realistic persistence in the native Lua dev server.

### Design goal

Mirror the old IDE SQLite semantics, but in native Lua.

### Required behavior

- same command set
- same response shape
- same error kinds
- same reserved-field stripping
- same timestamps
- same default ordering behavior

### Storage shape

Reuse the conceptual model from the old IDE:

- one document table
- per-row metadata
- serialized payload data

Conceptually:

```text
tenant_documents
  tenant_key
  collection
  id
  data_json
  created_at
  updated_at
```

Even if the implementation details differ in Lua, preserving this model keeps
future parity with a later WASM-backed runtime much easier.

### Tooling caveat

This step depends on what native SQLite access is acceptable in this repo.

If there is no acceptable pure-Lua/native binding available without violating
the "minimal dependencies" direction, then the flat-file provider may need to
remain the persistence option for a little longer.

That is fine temporarily, but the provider boundary should still be introduced
now.

## Phase 6: Test the Same Payload Against Both Providers

After `memory` and `sqlite-local` exist, the same `payloads/current/` app
should run against both.

That is the real proof that the payload is storage-agnostic.

### What to verify

- same visible behavior
- same success paths
- same error behavior
- same returned HTML after mutations

This is where the interaction button from Phase 2 becomes useful: it is the
smallest possible cross-provider acceptance test.

## Phase 7: Keep Payload and IDE UI Separate in the Repo Layout

After the payload proves split views, interaction, and provider-backed
persistence, the repo structure should make the distinction obvious.

Recommended shape:

```text
fuwa/
  docs/
    architecture.md
    implementation-plan.md
    refactoring/
  payloads/
    current/
      app.fuwa
      views/
      pages/
      models/
      hooks/
  runtime/
    fuwa-dev.lua
    db/
      init.lua
      provider.lua
      providers/
        memory.lua
        sqlite_local.lua
    stdlib/
      db.lua
      result.lua
      schema.lua
      view.lua
      web.lua
      compiler/
  tests/
    compiler_smoke.lua
    dev_server_smoke.lua
    unit/
      compiler/
      db/
```

This makes the ownership model explicit:

- `payloads/` = app content
- `runtime/` = host/runtime implementation
- `runtime/stdlib/` = Lua framework/runtime surface
- `tests/unit/db/` = provider behavior

## Suggested Execution Order

This is the recommended order of work.

1. split `payloads/current/view.fuwa` into smaller files
2. prove one fragment can receive data
3. add one interaction button to the current payload
4. define the DB provider boundary behind `__fuwa_db_op`
5. implement `memory`
6. test the current payload against `memory`
7. implement `sqlite-local`
8. test the current payload against both providers
9. only then expand toward larger payloads or IDE-host work

## What Not To Do Yet

To keep momentum and avoid context bleed:

- do not redesign the whole DSL first
- do not jump to WASM DB first
- do not expand IDE/editor features here
- do not let payload hooks become IDE host glue
- do not couple split-view support to a giant new templating system

## Final Recommendation

The next milestone should be treated as a **proof phase**, not a feature phase.

Success means:

- views are composable
- the client stack actually works
- persistence is provider-based
- payload and host concerns remain separate

If we hold that line, the repo stays on the Lua-first path instead of sliding
back into a hidden host-owned architecture.
