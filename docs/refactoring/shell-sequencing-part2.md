# Plan: Shell Sequencing, Part 2

Status: sequencing note. This document takes the existing shell plan and tightens
the next execution steps around the cheapest path that proves the most.

Read alongside:

- [shell-architecture.md](shell-architecture.md)
- [shell-implementation-plan.md](shell-implementation-plan.md)
- [telemetry-plan.md](telemetry-plan.md)

## Why this exists

The existing sequencing is directionally right:

- shell first
- one capability seam
- one hosted payload
- no editor panels yet

But one step was hiding the biggest decision in the whole rollout:

> "substrate provides iframe slot mounting"

That line quietly collapses two different boundaries into one milestone:

1. **Capability resolution**
   - the host runtime can resolve `host`
   - the tenant runtime cannot
2. **Physical isolation**
   - the tenant cannot reach into the host even if it tries

Those are not the same thing. The first is module availability. The second needs
an actual document/process boundary.

This note splits them cleanly and picks the cheapest interim substrate that
still proves both.

## The refinement

Do **not** start by jumping straight to:

- worker boot
- Wasmoon
- browser bridge
- `postMessage`
- iframe-worker-runtime symmetry

That would violate the spirit of the shell plan's own restraint.

Instead, use the dev server you already have.

## The cheap path that proves more

The current dev server is fork-per-connection.

That means you can get real host/tenant separation immediately by serving:

- `/` -> shell app
- `/payload/:id` -> payload app

Then `host.mount_payload("preview", "current")` does something extremely small:

- validate the payload id
- produce the route for that payload
- return enough state for the shell to render an ordinary iframe

The shell then renders:

```html
<iframe src="/payload/current" sandbox="allow-scripts allow-forms"></iframe>
```

That buys you:

- separate host and tenant requests
- separate Lua process forks
- real browser document isolation
- no compiler changes
- no worker/wasm/postMessage substrate yet

This is a better first proof than building the heavier browser topology early.

## Interim vs future

The important thing is that the **shell-facing capability stays the same**.

### Interim now

```text
host.mount_payload("preview", "current")
        |
        v
<iframe src="/payload/current">
payload runs in a separate server fork
```

### Future later

```text
host.mount_payload("preview", "current")
        |
        v
<iframe> hosts worker runtime
payload runs in Wasmoon with bridge + postMessage
```

The shell does not need to care which substrate is under the seam.
That is the whole point of introducing the seam now.

## The two boundaries, explicitly

### Boundary A: capability resolution

This is runtime/module-level.

- host resolves `host`
- tenant does not

Proof required:

- a payload that writes `use host` must fail to resolve it

This should be tested as soon as the host and tenant runtimes diverge.

### Boundary B: physical isolation

This is substrate/browser-level.

- host and tenant are different documents
- tenant cannot directly mutate host DOM/state

With the route-based iframe interim, you get this cheaply and honestly.

That is enough for the first milestone.

## The key rule: do not let slots become language features

Do **not** add host-specific syntax like:

```fuwa
mount "preview", "current"
```

or a special view directive for slots.

That would be host bleed into `.fuwa`, which the shell plan explicitly rejects.

Instead:

- the host calls `host.mount_payload(...)`
- host state receives the route or mount descriptor
- the shell renders an ordinary iframe using normal template interpolation

The language stays ignorant.

## Telemetry should land at the seam immediately

The first real host capability should be instrumented from day one.

Specifically:

- wrap `host.mount_payload(...)` in a telemetry span
- record:
  - `slot`
  - `payload_id`
  - success/failure
  - duration

This is exactly the kind of seam [telemetry-plan.md](telemetry-plan.md) is for.

If this flow becomes the first real host-runtime milestone, it should be
debuggable the moment it exists.

## Revised exact order

This is the concrete sequence I would use.

### 1. Split dev-server routing first

The dev server should explicitly serve two app classes:

- `/` -> shell
- `/payload/:id` -> payload

This is pure substrate work.
No compiler change.
No host language change.

### 2. Render shell chrome from `.fuwa`

The shell becomes the visible top-level app.

At this stage:

- host renders outer chrome
- payload is not mounted yet

This is the shell proof-of-life.

### 3. Prove denial immediately

Before celebrating capabilities, prove the sandbox:

- payload code attempting `use host` must fail to resolve

Do not assume this boundary.
Test it.

### 4. Add `host.mount_payload(slot, payload_id)`

Keep it thin:

- validate payload id
- resolve route
- emit telemetry span
- return mount descriptor/route

No editor APIs.
No giant host service.

### 5. Shell renders one iframe slot

The shell should render one phone-shell area containing one iframe.

At this step:

- host owns the phone-shell frame
- substrate owns iframe semantics
- tenant owns iframe content

### 6. Mount `payloads/current`

Only one payload at first:

- `current`

Success means:

- shell hosts tenant
- tenant is isolated
- host capability seam is real

### 7. Build phone-shell chrome around the slot

The iframe alone is not the dogfooding win.
The shell-authored phone frame is.

That is where the first serious host UI belongs:

- frame
- title
- shell chrome
- loading/error presentation

### 8. Add payload switching or lesson nav

Only after one payload mount works:

- payload switcher
or
- lesson nav

Using existing payload ids is enough:

- `current`
- `lesson`

### 9. Later: substrate swap

Once the seam and shell are proven, then you can replace:

- route-based iframe + server fork

with:

- iframe + worker + Wasmoon + postMessage bridge

without changing the shell-level capability contract.

### 10. Only then move toward real IDE tooling

That means:

- editor panels
- file tree
- authoring state
- status/inspector panels

Not before.

## What this sequencing proves

This route-based interim proves:

- the shell is the host
- the host can call a privileged capability
- the tenant cannot
- isolation is real
- the language stays clean
- the capability seam is stable enough to survive a substrate swap later

That is more valuable than prematurely proving worker symmetry.

## Acceptance criteria

This sequencing is successful when:

1. the dev server serves `/` as shell and `/payload/:id` as tenant
2. the shell renders top-level chrome from `.fuwa`
3. a payload trying to `use host` fails to resolve it
4. `host.mount_payload("preview", "current")` resolves a mountable payload route
5. the shell displays `payloads/current` inside an iframe
6. the phone shell chrome is shell-authored, not substrate-authored
7. telemetry spans exist at the `mount_payload` seam
8. switching from `current` to `lesson` works without changing compiler behavior

## Final recommendation

Do not spend the next iteration building the full browser topology.

Spend it proving the host/tenant seam with the cheapest honest substrate:

> route-based iframe hosting first, worker symmetry later

That gives you real isolation, real dogfooding, and a stable capability verb
without paying the heavier runtime cost too early.
