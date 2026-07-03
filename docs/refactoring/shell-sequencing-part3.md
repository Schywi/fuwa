# Plan: Shell Sequencing, Part 3

Status: sequencing note. This document expands the later transition that
Part 2 intentionally kept high-level:

- the substrate swap behind `host.mount_payload(...)`
- the first real IDE-host surfaces after the seam is proven

Read alongside:

- [shell-architecture.md](shell-architecture.md)
- [shell-sequencing-part2.md](shell-sequencing-part2.md)
- [telemetry-plan.md](telemetry-plan.md)

## Why this exists

Part 2 deliberately stopped at the route-first iframe interim:

- `/` serves the shell
- `/payload/:id` serves the tenant
- `host.mount_payload(...)` stays thin
- the shell renders a real sandboxed iframe

That is the right first proof.

But it leaves two questions open:

1. what does the **future substrate** look like once we move beyond route-backed
   iframe hosting?
2. what is the **first real IDE UI** once the shell is no longer just a proof?

This note answers those two questions without collapsing back into a god wrapper.

## Short answer first

- **Now**: use route-backed iframe hosting
- **Later**: use a host-owned iframe bootstrap document, most likely `srcdoc`
  or an equivalent host-controlled bootstrap page
- **Do not** make blob URLs the primary app transport
- **Preserve** the current `shell/.fuwa` desktop CSS/layout as much as possible
- **Desktop only for now**
- **Allow** `/shell/hooks` only as a narrow host-side imperative escape hatch,
  similar to the old payload hook model, not as a second rendering system

## The substrate choice: `src`, `srcdoc`, or blob?

This is the core design choice for the later browser runtime.

### 1. Interim now: route-backed `src`

This is still the right current answer.

```html
<iframe src="/payload/current/" sandbox="..."></iframe>
```

Why:

- cheapest honest isolation
- simple request model
- easy to debug
- no compiler change
- no worker/wasm/bootstrap ceremony yet

This should remain the first real proof.

### 2. Later: host-owned iframe bootstrap

When the browser worker topology returns, the iframe should stop being just a
remote route document and become a **hosted runtime container**.

That means the iframe document itself should be host-controlled, and the tenant
content should be mounted into that container.

That points to two viable designs:

1. `iframe srcdoc="...bootstrap..."`
2. `iframe src="/tenant-shell/current"` where that shell document is generated
   by the host/runtime, not treated as a normal payload route

Of those two, I would favor **`srcdoc` or an equivalent host-generated bootstrap
document** for the later substrate swap.

Why:

- the host fully owns the bootstrap HTML
- the host can inject the bridge/runtime loader deliberately
- the shell/payload seam stays explicit
- the iframe is still a real document boundary
- you avoid pretending the runtime container is "just another payload route"

### 3. Blob URLs: not the primary transport

Blob URLs are fine as a tactical tool for isolated asset injection, but they
should **not** become the primary architecture for tenant app mounting.

Reasons:

- relative URL behavior gets awkward
- debugging gets worse
- identity/lifecycle becomes host-managed in a fragile way
- you start rebuilding a bundler/runtime cache story by hand
- it drifts back toward the old "host invents a special transport" smell

So the rule should be:

- **route-backed iframe first**
- **host-owned bootstrap document later**
- **blob only for narrow, local asset cases if unavoidable**

Not the other way around.

## My recommendation on `srcdoc`

### Should we use `srcdoc` to solve the current iframe issue?

No, not as the immediate fix.

The current route-first model should be fixed on its own terms first:

- correct sandbox/origin behavior
- correct HTMX routing inside the iframe
- correct dev reload behavior
- correct module/script handling

Switching to `srcdoc` now would mix:

- a substrate migration
- a bug fix
- a topology jump

That is too much at once.

### When should `srcdoc` be used?

Use it later, when the tenant stops being served as a plain route-backed HTML
document and starts being booted inside a browser runtime container.

At that point `srcdoc` becomes attractive because the iframe document is no
longer "the payload page"; it is "the host-provided tenant runtime shell."

That is a different job.

## The future substrate shape

Part 2 kept the capability stable:

```text
host.mount_payload("preview", "current")
```

That must still hold in the later topology.

### Future flow

```text
shell/.fuwa
    |
    | host.mount_payload("preview", "current")
    v
host runtime
    |
    | returns a mount descriptor
    v
iframe bootstrap document
    |
    | loads worker/runtime bridge
    v
tenant app compiled from payloads/current
```

### ASCII

```text
NOW
===

shell/.fuwa
    |
    | host.mount_payload("preview", "current")
    v
+--------------------------------------+
| iframe src="/payload/current/"       |
+--------------------------------------+
    |
    v
payload route -> server-side Lua render


LATER
=====

shell/.fuwa
    |
    | same host.mount_payload("preview", "current")
    v
+--------------------------------------+
| iframe srcdoc="tenant bootstrap..."  |
+--------------------------------------+
    |
    v
bridge + worker boot + tenant runtime
    |
    v
payload compiled from payloads/current
```

The shell contract stays the same. Only the substrate beneath it changes.

## Preserve the battle-tested shell

This is important and should be a rule.

The current `shell/.fuwa` layout and CSS have already done real work. They are
not throwaway placeholders anymore.

Files that should be treated as a stable design baseline:

- [shell/view.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/view.fuwa)
- [shell/views/layout.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/layout.fuwa)
- [shell/views/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/home.fuwa)

### Rule

When phases 9 and 10 land:

- preserve the current desktop shell visual language as much as possible
- evolve it carefully
- do not throw it away in favor of a new generic layout just because the
  substrate changes underneath

The phone shell and host surfaces should feel like a refinement of the current
shell, not a reset.

## Desktop only

This phase should explicitly target desktop only.

Do not expand scope into mobile right now.

That means:

- desktop layout assumptions are allowed
- panel density can be desktop-oriented
- the phone shell is a desktop-hosted preview device, not a mobile shell rewrite

Mobile can come later once:

- host seam is stable
- tenant mount substrate is stable
- editor surfaces exist

## `/shell/hooks`: allowed, but narrow

This is the other important scope valve.

Yes, a `/shell/hooks` concept is reasonable if needed, similar to the old
payload-side hooks in `/repos/IDE`.

But it should be constrained.

### What `/shell/hooks` is for

Use it for imperative host-side glue that does **not** deserve a language
feature and does **not** belong in substrate:

- tiny bridge activation
- htmx lifecycle glue
- petite-vue host activation
- one-off DOM behaviors for the shell
- focused host-side animation or measurement

### What `/shell/hooks` is not for

Do not let it become:

- a hidden second host framework
- business logic storage
- routing logic
- capability implementation
- a replacement for `.fuwa` screens

### Practical rule

- screen shape -> `.fuwa`
- browser/runtime plumbing -> substrate
- tiny imperative host glue -> `/shell/hooks`

If a hook starts owning screen behavior, that logic belongs back in `.fuwa`.

## Phase 9 in detail: substrate swap

This phase happens only after Part 2 succeeds.

### Preconditions

Before phase 9 starts, all of these should already be true:

- shell renders as top-level app
- one payload mounts through `host.mount_payload`
- iframe route hosting works
- host capability denial is proven in payloads
- phone shell visuals are shell-owned

### Goal

Replace the route-backed iframe substrate with a browser-runtime substrate
without changing:

- the compiler contract
- the host capability verb
- the shell screen structure

### Work items

1. Introduce a host-owned iframe bootstrap document.
2. Move tenant runtime boot responsibilities into that bootstrap layer.
3. Keep `host.mount_payload(...)` returning a stable mount descriptor.
4. Teach the host runtime to choose the later substrate instead of route `src`.
5. Preserve tenant isolation and host capability denial.

### Important constraint

Do not let the shell learn about:

- worker boot
- Wasmoon
- `postMessage`
- runtime bridge details

That knowledge belongs strictly below the seam.

### Success condition

The shell still renders the same phone shell and host layout, but the mounted
tenant is now hosted by the browser runtime substrate instead of a route-backed
HTML response.

## Phase 10 in detail: real IDE host surfaces

This phase begins only after the seam and substrate are stable enough that
adding more host UI will not destabilize the architecture.

### What phase 10 includes

Start adding actual IDE-like host surfaces:

- lesson navigation
- payload switcher
- host status rail
- inspector/debug panel
- edit panel
- file tree

### Recommended order inside phase 10

1. lesson navigation
2. payload switcher
3. host status / inspector rail
4. file tree
5. edit panel

Do not start with the edit panel first.

### Why not the edit panel first

The edit panel is where:

- authoring state
- shell state
- runtime state
- file system assumptions

all collide.

That is the most dangerous place to reintroduce god-wrapper logic.

### Host UI rule in phase 10

Each new surface must be classified before implementation:

- screen-shaped -> `shell/.fuwa`
- runtime glue -> substrate
- tiny imperative DOM glue -> `/shell/hooks`

No exceptions without an explicit reason.

## Detailed sequencing for phases 9 and 10

```text
PHASE 9
-------
1. keep route-first seam stable
2. introduce host-owned iframe bootstrap
3. move tenant runtime boot behind bootstrap
4. swap substrate under host.mount_payload
5. preserve shell visuals and capability behavior

PHASE 10
--------
1. add lesson nav
2. add payload switcher
3. add host inspector/status rail
4. add file tree
5. add edit panel
6. expand shell/hooks only when tiny imperative glue is truly needed
```

## Acceptance criteria

This part of the sequencing is successful when:

1. the shell still uses the same `host.mount_payload(...)` contract after the
   substrate swap
2. route-backed iframe hosting can be replaced without compiler changes
3. the shell desktop layout remains recognizably the same after the swap
4. the tenant remains isolated from the host
5. `/shell/hooks` exists only as a narrow imperative escape hatch
6. the first real IDE-facing surfaces are added without moving runtime plumbing
   back into the shell or the language

## Final recommendation

For the immediate bug-fixing phase:

- stay on route-backed iframe hosting
- do not jump to `srcdoc` just to patch the current issues

For the later architecture:

- prefer a host-owned bootstrap document
- likely `srcdoc` or an equivalent generated shell
- avoid blob URLs as the primary transport

And for the host UI itself:

- preserve the current desktop shell
- keep mobile out of scope
- use `/shell/hooks` only when the logic is too imperative for `.fuwa` but too
  small to justify substrate ownership
