# Implementation Plan: From Shell Proof to Real Hosted UI

Status: execution plan. This document starts from the current repo state and
turns the shell architecture into concrete next steps.

Read alongside:

- [shell-architecture.md](shell-architecture.md)
- [dev-server-plan.md](dev-server-plan.md)
- [implementation-plan.md](../implementation-plan.md)

## Where We Are Today

The repo already has the beginnings of the shell model:

- a host shell app in [shell/](/mnt/DATA/development/projects/repos/fuwa/shell)
- payload apps in [payloads/](/mnt/DATA/development/projects/repos/fuwa/payloads)
- a dev server in [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:1)
- a host capability module in [runtime/host/capabilities.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua:1)
- a canonical runtime/compiler tree in [runtime/stdlib/](/mnt/DATA/development/projects/repos/fuwa/runtime/stdlib)

Current app trees:

```text
shell/
  app.fuwa
  pages/home.fuwa
  view.fuwa
  views/home.fuwa
  views/layout.fuwa

payloads/
  current/
  lesson/
```

That means the problem is no longer "can we have a shell at all?"
The problem is now:

1. make the dev server load the shell as the host app
2. make the shell host a payload
3. introduce the phone shell and iframe boundary cleanly
4. only then start adding real IDE-facing screens

## The Immediate Goal

The next milestone is:

> a `.fuwa`-authored host shell renders outer chrome, mounts one payload into a
> phone-shell slot, and keeps the host/payload/substrate boundary intact

That is the first real proof that the host is not just decorative.

## The Three Layers We Must Keep Separate

This distinction is non-negotiable during implementation.

### 1. `shell/` = host screens

This owns:

- hero
- navigation
- shell chrome
- lesson switcher
- host panels
- phone shell visual frame

Anything with screen shape belongs here.

### 2. `payloads/` = tenant lesson/apps

This owns:

- lessons
- demos
- apps
- content screens
- payload-specific hooks and behavior

These are what the shell hosts.

### 3. substrate/runtime = plumbing

This owns:

- iframe creation
- sandbox creation
- payload boot
- capability resolution
- message bridge
- runtime mounting

This is not authored as screens.

### Critical boundary rule

- phone shell **visuals** belong to `shell/`
- iframe **creation/mounting** belongs to substrate/runtime
- lesson/app content belongs to `payloads/`

If these collapse back together, the old `/IDE` context bleed returns.

## Phase 1: Make the Dev Server Load the Shell First

Right now the dev server is still conceptually payload-first.
That has to change.

### Goal

`runtime/fuwa-dev.lua` should load:

- `shell/` as the host app
- one payload as hosted tenant content

The request path should treat `shell/` as the primary rendered app.

### Implementation work

1. Add explicit host app loading in the dev server.
2. Keep payload loading separate from host loading.
3. Stop hard-wiring the server to one payload-as-root mental model.

### Recommended runtime shape

The dev server should conceptually load two app trees:

```text
host_files   = collect(shell/)
tenant_files = collect(payloads/current/)
```

The host build drives the outer response.
The tenant build is mounted into a slot only when requested by the host
capability seam.

### Acceptance criteria

- shell routes render as the primary app
- payloads are no longer treated as the only top-level app
- shell and payload file maps remain distinct

## Phase 2: Define the Smallest Real Capability Seam

Do not build “IDE APIs.” Build one privileged verb.

### First capability

Start with:

- `host.mount_payload(slot, payload_id)`

Optional second capability only if needed immediately:

- `host.switch_payload(payload_id)`

### Responsibilities

`host.mount_payload(slot, payload_id)` should:

- identify the target slot in the host UI
- resolve the payload by id
- boot or render the payload in a sandboxed mount
- return enough information for the host to display it

### What it should not do yet

- no editor/file APIs
- no authoring controls
- no lesson indexing system unless required
- no broad capability surface

### Acceptance criteria

- host shell can call `mount_payload`
- payloads cannot resolve `host`
- compiler remains unchanged

## Phase 3: Build the Phone Shell the Right Way

This is the first serious UI decision.

### Split the phone shell into two parts

#### Host-screen part (`shell/`)

This should live in `.fuwa`:

- phone frame
- bezel/chrome
- title area
- layout around the embedded app
- shell-level loading/error presentation

#### Substrate part (`runtime/`)

This should stay runtime code:

- iframe element creation
- sandbox attributes
- mount target management
- runtime bootstrapping
- postMessage wiring if/when the browser topology lands

### Why this split matters

If the phone shell becomes only substrate, the host stops dogfooding itself.
If iframe plumbing moves into `.fuwa`, browser internals leak into the language.

The split must hold.

### Recommended file direction

Add shell-side view files like:

```text
shell/
  views/
    layout.fuwa
    home.fuwa
    phone_shell.fuwa
    fragments/
      hero.fuwa
      lesson_nav.fuwa
      preview_slot.fuwa
```

And keep the mount logic under runtime:

```text
runtime/
  host/
    capabilities.lua
    mounts.lua
```

### Acceptance criteria

- phone shell frame is rendered by the shell app
- payload mount happens through runtime capability code
- one hosted payload can appear inside the phone shell frame

## Phase 4: Mount One Payload End to End

This is the proof-of-life milestone.

### Scope

Only one hosted payload:

- `payloads/current`

No multi-payload switching yet if it complicates the first path.

### Flow

1. request shell page
2. shell renders host chrome
3. shell asks runtime to mount payload into slot
4. payload renders inside mounted region
5. host frame and tenant content are visibly separate

### What to verify

- host shell is still the top-level app
- tenant content stays sandboxed
- host capability does not leak into tenant code
- visual nesting is correct

### Acceptance criteria

- one shell page shows one mounted payload
- payload content is visible inside the phone shell
- host and payload can be debugged as separate concerns

## Phase 5: Add the First Real Host Surface

Only after mount works should we add a true host-facing screen.

### Recommended first surfaces

Pick one:

1. hero
2. lesson nav
3. payload switcher

Recommended order:

- first: hero or lesson nav
- second: payload switcher

Do **not** start with full editor panels.

### Why not editor first

Editor UI pulls in:

- file system assumptions
- authoring state
- layout complexity
- runtime/editor coupling

That is too much before the host/payload seam is proven.

### Acceptance criteria

- first host surface is `.fuwa`-authored
- it interacts through the capability seam where needed
- it does not require new host-specific language features

## Phase 6: Add Payload Switching

Once one payload mount works, then add:

- `host.switch_payload(payload_id)`

### Minimum behavior

- shell lists a small set of payload ids
- clicking one switches the mounted tenant
- switching updates only the hosted payload region

### Good early target

Use existing payload directories:

- `current`
- `lesson`

That is enough to prove switching without building a larger content system.

### Acceptance criteria

- shell can mount `current`
- shell can switch to `lesson`
- tenant remains sandboxed after switching

## Phase 7: Only Then Start Talking About IDE UI

The “real IDE UI” comes after the hosting model is proven.

This includes:

- edit panels
- file tree
- settings panels
- runtime status panels
- authoring surfaces

### Why this is later

These are not just more host screens. They are where host state, authoring
state, and runtime orchestration all collide.

If we build them before proving:

- shell renders
- shell mounts payloads
- capability seam works
- phone shell split is clean

then we recreate the old host chaos too early.

## Suggested Folder Direction

This is the near-term folder shape this plan is steering toward.

```text
fuwa/
  shell/
    app.fuwa
    pages/
    views/
      layout.fuwa
      home.fuwa
      phone_shell.fuwa
      fragments/
        hero.fuwa
        lesson_nav.fuwa
        preview_slot.fuwa
  payloads/
    current/
    lesson/
  runtime/
    fuwa-dev.lua
    host/
      capabilities.lua
      mounts.lua
    stdlib/
      compiler/
      db.lua
      result.lua
      schema.lua
      view.lua
      web.lua
```

## Concrete Execution Order

This is the recommended order of implementation.

1. make `runtime/fuwa-dev.lua` load `shell/` as the primary app
2. keep payload loading separate from shell loading
3. define `host.mount_payload(slot, payload_id)`
4. add runtime mount plumbing for one slot
5. create shell-side phone shell UI
6. mount `payloads/current` inside the phone shell
7. add one host-facing screen: hero or lesson nav
8. add `host.switch_payload(payload_id)`
9. switch between `current` and `lesson`
10. only then begin IDE-facing panels

## What Not To Do Yet

To keep this clean:

- do not add a broad host API
- do not start with edit panels
- do not move iframe/browser plumbing into `.fuwa`
- do not merge shell and payload directories conceptually
- do not add host-specific syntax to `.fuwa`
- do not force the full dual-worker symmetry before the shell proves itself

## Acceptance Criteria

This phase of the shell work is done when:

1. the dev server renders `shell/` as the host app
2. the shell can mount one payload through `host.mount_payload`
3. the phone shell UI is shell-authored while iframe boot remains substrate
4. `payloads/current` renders inside the shell-hosted frame
5. `payloads/lesson` can be switched in through `host.switch_payload`
6. payload code cannot resolve host capabilities
7. no compiler changes were required to make any of this work

## Final Recommendation

The next milestone is not “build the IDE.”

It is:

> make the shell actually host a payload inside a phone shell through one small
> capability seam

Once that works, the rest of the host UI becomes an expansion problem instead of
an architecture problem.
