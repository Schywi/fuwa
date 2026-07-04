# Skeptical Comparison: `fuwa` Versus `/IDE`

This is intentionally conservative. If something is only half-built, it is
marked as partial or missing.

## Core Architecture

| Area | `/IDE` | `fuwa` | Verdict |
|---|---|---|---|
| Desktop shell host | Svelte-based host UI | `.fuwa` shell route exists | Partial |
| Payload app model | desktop test payloads + lessons + preview host | tenant payloads exist | Partial |
| Browser runtime | Wasmoon + worker bridge + iframe runtime | browser runtime stub only | Missing |
| Lua compiler/runtime | TS compiler + worker target | real Lua compiler port | Implemented |
| DB provider | browser/runtime-aware session path | Lua providers exist | Partial |
| Host/payload separation | explicit host shell + tenant runtime | explicit shell/payload routes | Implemented |

## Desktop IDE Surface

| Surface | `/IDE` | `fuwa` | Verdict |
|---|---|---|---|
| Search popover | present | absent | Missing |
| File dropdown/list UX | present | partial file tree only | Partial |
| Breadcrumb / runtime header | present | basic status cards only | Partial |
| Asset switcher | present | absent | Missing |
| Phone shell bridge | mature | route-backed iframe proof only | Partial |
| Editor pane | mature | basic CodeMirror mount | Partial |
| Terminal pane | mature | basic xterm mount | Partial |
| Live save/run loop | mature | shell compile-on-save scaffold | Partial |
| Preview refresh stability | mature | iframe reloads too easily | Missing |
| Pixel parity | polished | proof shell styling | Missing |

## Runtime Orchestration

| Area | `/IDE` | `fuwa` | Verdict |
|---|---|---|---|
| Runtime session model | `RuntimeSession.ts` | host dashboard data shaping only | Missing |
| Adapter abstraction | worker adapter + runtime bridge | no full public equivalent | Missing |
| Worker bootstrap | `worker.ts` | browser init stub | Missing |
| Bridge protocol | `runtime-bridge.js` | narrow shell hooks only | Partial |
| Request handling | request/events handled in worker | route-backed Lua dev server | Partial |
| Tenant command queue | present | absent | Missing |

## What Is Actually Strong In `fuwa`

- the Lua compiler port is real
- route-backed shell hosting works
- vendored runtime assets exist locally
- the host capability seam is explicit
- shell and payload routes are separable

That is good progress, but it is not equivalent to the real desktop IDE.

## What Must Not Be Confused With Parity

The following are proof surfaces, not parity surfaces:

- route-backed iframe mounting
- shell fragment split
- editor hook mount
- terminal hook mount
- compile-on-save loop

Those prove the system can evolve. They do not prove the `/IDE` desktop UI and
runtime orchestration have been ported.

