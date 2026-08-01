# `fuwa-gomen` Payload Lua/.fuwa Port Plan

## Status

- `FUWAGOMENREFACTOR:postponed`

This plan documents the correct direction so later work does not repeat the same
analysis.

## Scope

This plan is specifically about `payloads/fuwa-gomen`.

It does not try to redesign every payload at once. `fuwa-gomen` is the right
target because it is the clearest example of too much app logic living in JS.

## Problem statement

`fuwa-gomen` currently splits app behavior across too many layers:

- `.fuwa` models define persisted state
- `.fuwa` actions define server-side updates
- `.fuwa` views define structure
- browser JS re-derives core state
- browser JS mirrors business rules
- browser JS performs optimistic local state updates
- browser JS then nudges the server to catch up

This makes the payload harder to read than it needs to be. A reader must jump
between models, routes, templates, hidden DOM seeds, and a custom JS state
machine to understand a small feature.

That is the opposite of the repo's "Lua is the language, JS is glue" rule.

## Desired end state

The payload should read like a small app, not like two partial apps fighting
each other.

Desired ownership:

- `.fuwa` / Lua owns:
  - item catalog
  - wallet math
  - mood rules
  - receipt shaping
  - server-side action semantics
  - all persistent state changes
- `.fuwa` views own:
  - HTML structure
  - declarative state display
  - simple loops and conditionals
- JS owns only:
  - animation
  - browser-only DOM effects
  - tiny mount/bootstrap glue

## Current JS that needs scrutiny

Primary files:

- `payloads/fuwa-gomen/browser.js`
- `payloads/fuwa-gomen/hooks/game.js`
- `payloads/fuwa-gomen/hooks/fx.js`
- `payloads/fuwa-gomen/hooks/mood.js`
- `payloads/fuwa-gomen/hooks/content.js`
- `payloads/fuwa-gomen/hooks/bootstrap.js`

The main smell is `game.js`: it behaves like the real app brain.

## What should move out of JS

### Move to `.fuwa` / Lua

#### 1. Item catalog

Current examples:

- ids
- icons
- labels
- prices

Why move:

- this is app data, not browser glue
- views and actions both depend on it
- duplicating it in JS makes drift likely

Target:

- one Lua-owned source of truth

#### 2. Mood derivation

Current examples:

- balance to mood mapping
- poke thresholds
- cry/worried/happy branching

Why move:

- this is domain logic
- it should be testable without a browser

Target:

- Lua helper or view-model shaping before render

#### 3. Receipt derivation and totals

Current examples:

- receipt row shaping
- total calculation
- display text generation

Why move:

- these are deterministic data transforms
- there is no reason they should be browser-owned

#### 4. Persistent action semantics

Current examples:

- feed action changes wallet and ledger
- reset action clears state
- calm action resets pokes

Why move:

- this already exists server-side
- the browser should not be a second authority

#### 5. Refusal/business rules

Current examples:

- "not enough money"
- balance checks
- item affordability rules

Why move:

- domain rules belong with the rest of domain state

### Keep in JS

#### 1. GSAP motion

- food fly animation
- chew animation
- poke shake
- refusal spit effect

#### 2. DOM-only timing glue

- schedule animation callbacks
- attach event target positions to motion helpers

#### 3. Minimal bootstrap

- initialize petite-vue if needed
- run HTMX processing if needed

## Recommended architecture

### Server/browser truth model

The payload should stop pretending the browser owns the domain model.

Preferred model:

1. user triggers action
2. UI may animate immediately
3. action goes through the app route
4. server/Lua updates the true state
5. response rerenders current truth
6. browser enhances the result visually

This is much closer to PHP/Lapis thinking:

- request in
- app logic in server language
- HTML out
- JS enhances, not governs

### Runtime compatibility rule

The payload must still work in both modes:

- live browser Wasmoon preview
- deployed OpenResty public preview

That means moved logic should live in `.fuwa`/Lua, not in server-only escape
paths.

## Concrete refactor slices

### Slice 1: Move constants and derivation helpers

Target:

- replace `content.js` and `mood.js` ownership of domain data

Steps:

1. create Lua-owned item catalog helper
2. create Lua-owned mood derivation helper
3. shape the view data in actions before render
4. leave JS reading already-prepared state rather than computing it

Expected deletion:

- most of `content.js`
- most or all of `mood.js`

### Slice 2: Stop mirroring totals and receipt state in JS

Target:

- remove receipt and total calculations from `game.js`

Steps:

1. render receipt rows from Lua-owned state
2. render computed totals from Lua-owned state
3. keep JS from rebuilding receipt state from seed DOM

Expected deletion:

- hidden seed reconstruction logic
- local receipt row derivation

### Slice 3: Shrink the game state machine

Target:

- reduce `game.js` from "app brain" to "animation coordinator"

Steps:

1. remove local business-rule branches that duplicate server logic
2. keep only short-lived UI state:
   - current animation phase
   - refusal flash
   - temporary visual transitions
3. let server responses drive long-lived state

Expected result:

- `game.js` becomes small
- browser no longer owns balance/spent/counts as canonical truth

### Slice 4: Reevaluate `browser.js`

Target:

- make payload bootstrap boring

Possible end state:

- one tiny bootstrap file
- one animation module
- little or no payload-specific global namespace

## Implementation options

### Option A: HTMX-driven rerender after actions

Pros:

- simplest mental model
- server truth stays authoritative
- aligns with `.fuwa`/Lua ownership

Cons:

- interactions may feel less immediate unless animation is carefully staged

Use when:

- readability is the top priority

### Option B: local animation first, then server sync

Pros:

- more lively feel
- preserves some current playfulness

Cons:

- easier to accidentally reintroduce dual truth

Use when:

- animation quality matters, but server truth still wins

Recommendation:

- use Option B only with a strict rule:
  animation may be optimistic, domain state may not

## Suggested file outcomes

### Likely to shrink heavily

- `payloads/fuwa-gomen/hooks/game.js`
- `payloads/fuwa-gomen/hooks/content.js`
- `payloads/fuwa-gomen/hooks/mood.js`
- `payloads/fuwa-gomen/browser.js`

### Likely to remain

- `payloads/fuwa-gomen/hooks/fx.js`

### Likely to grow modestly

- `payloads/fuwa-gomen/pages/gomen.fuwa`
- view-layer `.fuwa` files that receive richer precomputed state

## Testing plan

### Lua-focused tests

- mood derivation
- item pricing
- affordability checks
- receipt totals
- reset behavior

### Integration tests

- page render at `/`
- feed item updates state correctly
- poke/pet/reset flows
- same visible behavior in:
  - browser Wasmoon preview
  - deployed OpenResty preview

### Regression tests

- browser animation still runs
- no stale duplicate totals
- no mismatch between rendered receipt and stored ledger state

## Success criteria

- a new reader can understand most app behavior from `.fuwa` files
- JS no longer duplicates core domain logic
- payload still feels lively
- payload still works in browser preview and deployed preview
- `game.js` reads like enhancement code, not business logic

## What not to do

- do not rewrite the payload as a larger JS framework app
- do not move logic into JS modules just because ESM is available
- do not invent a client-side store just to replace the current custom state
- do not make browser-only behavior the canonical truth

## Readability target

The payload should move closer to this standard:

- a kid can open the main `.fuwa` files and see what the app does
- the JS file explains only the "fun movement" parts
- the "why did balance change?" answer lives in Lua/.fuwa, not in browser
  bookkeeping
