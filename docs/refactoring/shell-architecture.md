# Plan: The Host Shell as a Privileged `.fuwa` App

Status: design. No code yet. This is the north star for how the host UI — the
thing that in `repos/IDE` was a Svelte "god wrapper" around the `.fuwa` iframe —
gets rebuilt in `.fuwa` itself, without dragging host concerns back into the
language.

Read alongside [architecture_discussion.md](architecture_discussion.md) (the
engine/hosts/payloads model and the dependency-inward rule) and
[port-compiler-to-lua.md](port-compiler-to-lua.md) (the compiler boundary this
plan must not violate).

## Why this exists

In `repos/IDE`, Svelte was a **god wrapper**: a separate, *more powerful*
framework babysitting the humble `.fuwa` payload. That hierarchy is the problem.
As long as the host is authored in a stronger language than the thing it hosts,
the dogfooding claim is hollow — "`.fuwa` is real!" rings false when the IDE
around it is written in something better.

The goal of this repo is a Lua-first, `.fuwa`-authored system. The strongest
possible proof that `.fuwa` is a real language is that **the host/IDE is built in
`.fuwa`** — the same language it teaches and runs. Like a compiler that compiles
itself. That is the credibility flex: show, on itch.io / open source, that `.fuwa`
built its own IDE and lessons.

## The core reframe: there is no god wrapper

The host UI is **just another `.fuwa` app** — same compiler, same runtime, same
render stack — that happens to run in a **privileged runtime** with a few extra
capabilities the sandboxed tenants don't get. Host and payload are the same
citizen. The only difference is a capability grant.

Everything else in this document follows from that one sentence.

## Guiding principles

Drawn from `.agent/rules/`, the engine/hosts/payloads model, and the three ideas
worth stealing from Evan You's progressive-framework / petite-vue work:

1. **One render stack, host and tenant.** The host uses the same
   petite-vue + htmx + UnoCSS + Lua model the tenant already uses. A second,
   host-only rendering path *is* the god wrapper rebuilt with extra steps. Do not
   introduce one.
2. **Progressive adoption.** Do not big-bang rewrite the host. `.fuwa` *earns*
   each surface by proving it can express it cleanly. What it hasn't earned yet
   stays substrate. Direction of travel is always toward more `.fuwa`, never
   forced.
3. **The compiler never learns that "host" exists.** Capabilities are a runtime
   concern (module availability), not a language or compiler concern. This keeps
   `compiler.core` pure — the non-negotiable rule from
   `.agent/rules/02-project-conventions.md`. If you find yourself adding a
   host-specific feature *to the language*, stop: that is the `/IDE` context bleed
   you are fleeing.
4. **No sockets.** The "server" is a local Web Worker in the same tab. htmx
   request/response over `postMessage` gives LiveView ergonomics with the socket
   deleted (see below).
5. **YAGNI all the way in.** Start with the smallest capability surface and the
   smallest converted screen. The non-goals fence at the end lists what we refuse
   to build.

## Runtime topology

```
┌──────────────────────────────────────────────────────────────┐
│  MAIN THREAD  (thin courier — NOT a framework you author in)   │
│  boots workers · owns DOM · htmx + petite-vue render layer     │
│  routes postMessage between host worker and tenant iframe      │
└───────────────┬──────────────────────────┬───────────────────┘
                │ privileged                │ sandboxed
                ▼                           ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│  HOST RUNTIME (worker)     │   │  TENANT RUNTIME (iframe+worker)│
│  shell/*.fuwa  → Lua       │   │  payloads/*.fuwa → Lua         │
│  ┌─────────────────────┐   │   │  ┌─────────────────────────┐  │
│  │ host screens (.fuwa) │   │   │  │ payload screens (.fuwa) │  │
│  │ hero · nav · editor  │   │   │  │ lessons · apps · content│  │
│  └──────────┬──────────┘   │   │  └─────────────────────────┘  │
│             │ calls         │   │        NO capabilities         │
│  ┌──────────▼──────────┐   │   └───────────────────────────────┘
│  │ CAPABILITY API      │   │
│  │ mount_payload()     │   │      ← same compiler, same runtime,
│  │ switch_payload()    │   │        different capability grant
│  └─────────────────────┘   │
└───────────────────────────┘
        SUBSTRATE (Lua/JS): wasm load · worker boot · postMessage · iframe sandbox
```

The host runs in its **own privileged worker**, symmetric with the tenant. The
main thread is a dumb courier: it boots workers, owns the DOM, runs the
htmx/petite-vue render layer, and routes `postMessage`. It is not something you
author application logic in. Full symmetry = no special-casing = no god wrapper.

## The three buckets and the one seam

Every piece of the host UI falls into exactly one bucket.

### Bucket 1 — Substrate (stays Lua/JS, permanently)

Worker boot, wasm loading, `postMessage` transport, iframe sandbox creation, the
main-thread DOM/htmx courier. Imperative browser glue with no state+view shape.
`.fuwa`-ifying this buys nothing and would drag browser APIs into the language.
YAGNI, permanently.

### Bucket 2 — Capability API (thin Lua, the seam)

The privileged verbs the host needs and tenants must never get. Start tiny:

- `host.mount_payload(slot, payload_id)` — boot a sandboxed tenant runtime for
  `payload_id` into the named iframe slot.
- `host.switch_payload(payload_id)` — swap the active payload in the primary slot.

Everything else (`list_payloads`, tenant-event subscription, etc.) is added the
day a screen actually needs it — rule of three. This is the **only** door from
host screens to substrate, and it is small enough to audit at a glance.

### Bucket 3 — Host screens (`.fuwa`, the dogfooding)

Hero, shell chrome, lesson nav, editor panels, settings — everything with the
shape of a screen (state + view + interaction). Structurally identical to a
payload. This is where "the IDE is written in `.fuwa`" becomes literally true.

### The rule that decides the bucket

> Screen shape (state + view + interaction) → `.fuwa` (bucket 3).
> Imperative browser/runtime plumbing → substrate (bucket 1).
> A privileged verb bridging the two → capability API (bucket 2).

This rule *is* the answer to "how far should the host be `.fuwa`?" — apply it per
surface, not once globally.

## How the compiler stays clean

The capability boundary is enforced at **runtime**, not in the compiler:

- A host screen writes ordinary `.fuwa`:

  ```
  module Shell

  use host

  import
    Nav "pages/nav"
  end

  routes do
    GET  "/"            Nav.index
    POST "/open/:id"    Nav.open
  end
  ```

- `use host` lowers exactly like any other import (`local host = require("host")`).
  **The compiler does not special-case it.** It has no idea `host` is privileged.
- The **host runtime instance** registers a `host` module in its module resolver,
  exposing the bucket-2 capabilities. The **tenant runtime instance** does not.
- In a payload, `use host` therefore *fails to resolve* → sandbox enforced by
  module availability, backed by the physical iframe isolation. Defense in depth,
  and the language never learns hosts exist.

This mirrors the telemetry plan's `emit ≠ sink` split: the code names a
capability; the *runtime* decides whether it resolves. Same discipline, same
boundary rule.

## The "without sockets" update loop

LiveView pushes DOM diffs over a websocket because the server is *remote* — it
needs a persistent pipe to reach into the page. In the north-star browser model,
the fuwa "server" is a **local Web Worker in the same tab**, so no persistent
socket is needed:

1. Host state lives in the host worker (Lua).
2. The host `.fuwa` renders HTML; the main-thread DOM displays it.
3. User interacts (clicks nav) → htmx request is intercepted → routed to the host
   worker over `postMessage` → the host action runs (e.g. `host.switch_payload`)
   → returns an HTML fragment → htmx swaps it → petite-vue re-activates it.

Request/response, ~zero latency same-tab. LiveView's ergonomics — server holds
state, sends rendered fragments — with the socket deleted. This is the *same* loop
payloads already use; the host just uses it too.

## Naming and layout

The host `.fuwa` app lives in **`shell/`** (sibling of `payloads/`). Rationale:
the README already speaks "shell" / "PhoneShell"; it is precise (the host shell
around payloads); `web/` collides with the compiler's `package_web`; `ui/` is
vague. This is a decision to confirm (see Open decisions).

```
shell/                     # first-party .fuwa host app (bucket 3)
  app.fuwa                 # host route declarations (uses `use host`)
  models/*.fuwa            # host state: active payload, nav, editor state
  pages/*.fuwa             # host page logic
  views/*.fuwa             # host chrome templates
  view.fuwa                # host entry template

payloads/                  # sandboxed tenant apps (unchanged, NO capabilities)
  current/ ...

runtime/                   # engine substrate + host runtime bootstrap
  host/                    # capability API (bucket 2) + privileged runtime wiring
    capabilities.lua       # mount_payload, switch_payload
  ...                      # (destined for hosts/browser-worker/ when that
                           #  split from architecture_discussion.md lands)
```

`shell/` mirrors the payload structure on purpose — it *is* a `.fuwa` app. The
dependency-inward rule still holds: `shell/` and `payloads/` depend on the engine
through the runtime; the engine depends on neither; the capability module is host
runtime code, never imported by `compiler.core`.

## Consequence to accept

Rewriting the host in `.fuwa` means the **host adopts petite-vue + htmx + UnoCSS
as its render stack**. The current README says those are "not compiled into the
host app… runtime dependencies of the tenant." That statement changes: one stack
everywhere is the *point*. Update the README when Phase 1 lands. Named here so it
is a deliberate call, not an accident.

## Phased rollout (progressive, minimal)

### Phase 0 — lock decisions

Confirm the four Open decisions below (name, worker placement, first surface,
README change). No code.

### Phase 1 — proof of life: the host renders itself

Stand up `shell/` with **one** self-contained screen (recommended: the **hero**
or **lesson nav**), running in a privileged worker, rendered through the *same*
reload loop as a payload. **No capabilities yet.** Success = the host renders its
own chrome from `.fuwa`, not Svelte. This proves the render stack works for the
host.

### Phase 2 — the capability seam: the host hosts a tenant

Introduce `host.mount_payload(slot, payload_id)`. The host `.fuwa` declares a
preview slot and mounts `payloads/current` into it. Success = a `.fuwa`-authored
host boots and displays a sandboxed `.fuwa` payload. **This is the milestone that
proves the whole model.**

### Phase 3 — the dogfooding demo: switch payloads

Add `host.switch_payload` (and `list_payloads` only if nav needs it). Build nav in
`.fuwa` that switches the mounted payload via the no-sockets loop. Success = a
lesson/app switcher, entirely `.fuwa`-authored, running the tenant it switches.

### Phase 4 — progressive conversion

Convert remaining chrome (editor panels, settings, phone shell frame) to `.fuwa`
one surface at a time, applying the bucket rule. Substrate shrinks as `.fuwa`
earns each surface. There is no "done" — this is a direction, not a finish line.

## Non-goals — the YAGNI fence

Explicitly **not** building until a concrete need forces it:

- Any new `.fuwa` language feature *for the host*. No host-specific syntax. The
  language stays capability-agnostic.
- A second, host-only rendering path or SPA framework in the main thread.
- Any capability beyond `mount_payload` / `switch_payload` (until a screen needs
  it).
- Converting substrate (worker boot, wasm, transport, sandbox creation) to
  `.fuwa`.
- Cross-boundary telemetry/trace propagation between host and tenant (owned by,
  and out of scope in, [telemetry-plan.md](telemetry-plan.md)).
- Editor/IDE feature work (code editing, lesson authoring UX) — downstream of a
  working shell.
- Websockets, SSE, or any persistent host↔worker channel beyond request/response.

Each of these bolts on later without rework, precisely because the seam is thin
and the compiler is capability-agnostic. Build them the day they are needed.

## Acceptance criteria

The shell model is proven, for MVP, when:

1. `shell/` is a `.fuwa` app that compiles through the existing compiler with **no
   compiler changes** (proves capability-agnosticism).
2. The host runs in its own privileged worker and renders its own chrome from
   `.fuwa` (Phase 1).
3. `host.mount_payload` boots a sandboxed tenant and displays a `.fuwa` payload
   inside the `.fuwa` host (Phase 2).
4. A tenant payload that writes `use host` **fails to resolve the capability**
   (verified by a test asserting the sandbox denies it), while the host resolves
   it — proving the boundary is real.
5. Payload switching works end-to-end through the no-sockets htmx loop (Phase 3).
6. The README's "not compiled into the host app" note is updated to reflect the
   unified render stack.
7. Comprehensive unit/acceptance tests cover: `shell/` compilation, capability
   resolution in the host runtime, capability *denial* in the tenant runtime,
   `mount_payload`, and `switch_payload` (per the `AGENTS.md` testing note).

## Open decisions (confirm in Phase 0)

1. **Name** — `shell/` (recommended) vs `ui/` vs `web/`.
2. **Where the host runs** — its own privileged worker (recommended, symmetric)
   vs a Lua runtime on the main thread.
3. **First surface to convert** — hero vs lesson nav.
4. **README change** — accept that host adopts petite-vue/htmx/UnoCSS.

## Risks

- **Bootstrapping.** The host worker needs the runtime/compiler available to run
  `shell/`. Keep the boot order explicit: main thread boots the host worker → host
  worker loads the engine + `shell/` → host mounts tenants. Do not let host boot
  depend on a tenant.
- **Expressiveness gap.** A host screen may need something `.fuwa` can't yet
  express. The pressure valve is the bucket rule: leave it in substrate until the
  language earns it. **Never** relieve the pressure by adding host-specific
  features to the language (that is the bleed).
- **Capability leak.** A tenant must be physically unable to resolve `host`. Test
  denial explicitly (acceptance criterion 4); rely on both module-resolver
  absence *and* iframe isolation (defense in depth).
- **Two-worker overhead.** Host + tenant workers cost memory and boot time.
  Acceptable for the debuggability/symmetry win; revisit only if it measurably
  hurts.
- **README/doc drift.** The unified render stack contradicts current README
  wording. Update it in Phase 1 so the public story stays coherent.
```
