# Plan: Minimal Span-Based Telemetry for fuwa

Status: design. No code yet. This document is the north star for how we get
debuggability into the server-side Lua without turning it into a framework.

## Why this exists

Today the only observability is `runtime/log.lua` (`log.log(scope, event, fields)`),
added in `eb12fda`, gated by a single boolean env var (`FUWA_TRACE=1` /
`FUWA_DB_TRACE=1`), writing flat `key=value` lines to stderr. It was a reasonable
first move, but it cannot answer the questions we actually have when our own code
misbehaves:

- **Where** did it happen — which stage, which provider?
- **What** was the state at that point?
- **How long** did it take?
- And critically: **which lines belong to the same request?**

Because the dev server forks one process per connection (`socat`), concurrent
requests interleave their stderr with nothing tying them together. That is
exactly the ambiguity that produced the "the `Broken pipe` line — is it evidence
the DB write failed?" moment: we were reading uncorrelated lines and inferring
causality by eye. That does not scale, and it is worst precisely where we can't
attach a debugger — a running server.

## What we want (and only this)

We want to debug **the code we write**: `.fuwa` logic, the compiler, the DB
providers, the request path. We want a correlated picture — where, what, how
long — per request. We want a `span:log("something")` ergonomic that drops an
entry into a trace we can actually read.

We do **not** want an observability platform. See the non-goals fence at the end.
This is deliberately Pareto-focused: the ~20% that gives us the debugging we need.

## Guiding principles

These come straight from `.agent/rules/` and the three ideas worth stealing from
Go's `context` and Elixir's `:telemetry` / OTel:

1. **Two levels only** (Cheney): `info` = one canonical line per request, always
   on; `debug` = the span tree, gated. No `warn`, no `fatal`. Errors are values
   that get returned/raised, not a log level.
2. **Wide events** (Majors): accumulate context during a unit of work and emit
   one structured line per span, sharing a trace id. Correlation over volume.
3. **Emit ≠ handle** (Valim): instrumented code says "this happened" and knows
   nothing about where it goes. But we have one sink, so we build one *swappable
   sink function*, not a handler registry. (Registry is added the day a second
   real consumer exists — rule of three.)
4. **No global catch.** A span records where it failed and **re-raises**. It never
   swallows an error to log it (this is antipattern #6 in `.agent/rules`).
5. **YAGNI all the way in.** Every feature below is the minimum. The fence at the
   end lists what we are explicitly refusing to build.

## The design: a thin span

A span is a named, timed scope with a `trace_id`, a `span_id`, a `parent_id`,
a start time, a depth, and an attributes bag. Spans nest to form a trace. That is
the entire concept. Target implementation size: one small Lua module in
`runtime/trace.lua`, ideally on the order of 80 lines, but the real constraint is
architectural rather than numerical:

- one module
- one swappable sink
- no registry
- no exporter layer
- no telemetry subsystem hiding behind helper files

If it starts growing sideways into multiple abstractions, we are overbuilding,
even if the line count stays low.

### API surface

```lua
local trace = require("runtime.trace")

-- Functional form (preferred): guarantees close, records failure, RE-RAISES.
local compiled = trace.span("compile", { files = n }, function(s)
  s:log("scanning source")
  ...
  s:log("emitted modules", { count = 3 })
  return result
end)

-- Manual form, for when a function boundary doesn't fit cleanly.
local s = trace.start("db.query", { op = "create" })
s:log("dispatched", { provider = "memory" })
s:close({ rows = 1 })   -- close attrs merge into the span's summary line
```

- `trace.span(name, attrs?, fn)` — opens a span, runs `fn(s)`, closes it. If `fn`
  raises, the span is marked failed with the error, closed, and the error is
  **re-raised unchanged**. This is a scoped ensure/defer, not a rescue: it does
  not span the app and does not swallow.
- `trace.start(name, attrs?)` / `s:close(attrs?)` — manual pair for awkward
  boundaries. The caller is responsible for closing.
- `s:log(msg, fields?)` — a point-in-time event inside the span. This is the
  `span:log(...)` ergonomic. Tagged with the span's `span_id`, `trace_id`, depth.
- `s:set(key, value)` — add one attribute to the span's summary line. (Thin
  convenience; `attrs` on open/close cover most cases.)

### Propagation: ambient current-span, justified by the process model

Lua has no implicit context propagation. We deliberately do **not** thread a `ctx`
argument through every function. Instead `runtime/trace.lua` keeps a module-level
**current-span stack**: opening a span pushes; closing pops; a new span with no
active parent starts a new trace with a fresh `trace_id`.

This is safe **because the dev server is fork-per-connection** (`socat`): one
process per request, no concurrency inside it, so module-level state cannot be
clobbered by another request. Go needs `context.Context` because it has real
concurrency; server-side, we don't, so we take the ergonomic win for free. Inner
code (`db/memory.lua`, `view.lua`) just calls `trace.span("db.memory", fn)` and it
auto-nests under whatever is active — no threading, no plumbing.

**Known boundary (not solved here):** the async browser worker / iframe runs many
requests in one Lua state and can interleave across `:await()` yield points, which
would corrupt an ambient stack. That environment is explicitly **out of scope**
for this plan (see non-goals). If/when we instrument it, that boundary gets an
explicit trace id carried in the request, not ambient state — a separate decision.

### Two tiers

| Tier | When | What |
|------|------|------|
| **Canonical line** | **always on** | one wide line per request: method, path, status, duration, `trace_id`, error if any |
| **Span tree** | `FUWA_TRACE=db,compile` | the nested spans and their `s:log` events |

Prod debugging loop: the always-on canonical line tells you *which* request died
and that it errored → reproduce with `FUWA_TRACE` set to the relevant scopes → get
the full tree. When tracing is off, `trace.span(name, attrs, fn)` degrades to
approximately `fn(noop_span)` (a no-op span whose `:log`/`:set` do nothing), so the
cost is negligible. The canonical line is cheap and unconditional.

Scope selection replaces the current single boolean. The matching rule should be
simple and explicit:

- `FUWA_TRACE=1` or `FUWA_TRACE=all` enables all debug spans
- `FUWA_TRACE=db,compile` enables spans whose names match by **prefix**
- prefix match means:
  - `db` enables `db.query`, `db.memory`, `db.sqlite_local`
  - `compile` enables `compile` and any later `compile.*` stage spans
- the canonical request line is **not** controlled by `FUWA_TRACE`; it is always on

`FUWA_DB_TRACE` can remain a migration alias briefly, but the end state should be
one env var, one matching rule.

### Emit ≠ sink

```
  your code  ──trace.span / s:log──▶  trace.emit(event)
                                          │
                                          ▼
                                    trace.sink   ◀── set ONCE by the host at boot
                                    (dev-server → stderr pretty-printer)
```

`trace.emit` builds a structured event and hands it to `trace.sink`. It does not
know what a sink does. The **host entrypoint** sets the sink:

- `runtime/fuwa-dev.lua` sets a stderr pretty-printer at boot.
- Tests set a capturing sink (append events to a table) to assert on telemetry.
- A future host (worker) could set a different sink without touching any
  instrumented code.

This keeps "how do I observe this" out of `compiler.core` and the DB layer — the
same engine/host boundary rule already in `.agent/rules/02-project-conventions.md`,
with no extra ceremony. `trace` is a tiny host-agnostic module; only the sink line
lives in the host.

### The canonical request line is host-owned

This should be explicit.

`runtime/trace.lua` should be generic span machinery. It should not hardcode
what a "request" is, or what fields a request line must carry.

The host runtime — today [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:1) —
owns that decision:

- it opens the root `request` span
- it decides the canonical fields:
  - method
  - path
  - status
  - duration
  - `trace_id`
  - error if present
- it decides how that canonical line is formatted at the sink

That keeps the trace core reusable and prevents request semantics from leaking
into lower layers like the compiler or DB providers.

### Output we expect to read

```
▶ request  GET /home                          trace=a1b2
  ▶ compile                       files=3     4.2ms
      · scanning source
      · emitted modules  count=3
  ▶ db.query          op=create   provider=memory
    ▶ db.memory        rows=1 saved=true       0.1ms
  ▶ render            view=home                1.1ms
◀ request  GET /home  status=200              6.8ms
```

Indented by span depth so nesting/causality is visible at a glance, correlated by
`trace=a1b2`, all from one process. The stderr pretty-printer derives indentation
from the event's depth field. (A machine-parseable flat `key=value` mode keyed by
`trace_id`/`span_id` can be a sink option if we ever pipe this somewhere — not
built now.)

## Where we instrument

A handful of seams — the places where "which side broke?" is the real question —
hand-placed, not sprinkled everywhere:

- `request` — in `runtime/fuwa-dev.lua`, wrapping the whole handler. Root span,
  emits the canonical line on close.
- `compile` — in the compiler entry (`runtime/stdlib/compiler`), optionally a span
  per stage later if a stage is suspect.
- `db.dispatch` — in `runtime/db/init.lua`, plus one span per provider in
  `runtime/db/providers/{memory,sqlite_local}.lua`.
- `render` — around view rendering.

That is roughly 5–6 span sites to start. We add a span when there is a real
"which layer?" question, not preemptively.

### Special note: `sqlite_local` is a first-class seam

In this repo, `sqlite_local` deserves explicit attention because it is not just
"another provider." It crosses a process/language boundary through the Python
helper in [runtime/db/providers/sqlite_local.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/db/providers/sqlite_local.lua:1).

That means `db.sqlite_local` should record at least:

- `op`
- `collection`
- `path`
- duration

And it is reasonable to add one or two point events inside the span, for example:

- helper dispatched
- helper returned

This is exactly the kind of seam where timing and correlation pay off
immediately.

## Relationship to the existing `runtime/log.lua`

`trace.lua` **supersedes** `log.lua` as the instrumentation API. To avoid a
big-bang rewrite:

1. Build `runtime/trace.lua` (spans + emit + sink + noop path).
2. Point `trace`'s default stderr sink at the existing serializer logic in
   `log.lua` (reuse the `serialize`/`%q` code — do not rewrite it). `log.lua`
   becomes a low-level formatting helper, not a public API.
3. Migrate the current call sites (`db/init.lua`, `db/providers/*.lua`,
   `fuwa-dev.lua`) from `log.log(scope, event, fields)` to spans / `s:log`.
4. Once nothing calls `log.log` directly, either fold its formatter into `trace`
   or keep it as `trace`'s internal serializer — whichever is smaller.

No behavior is lost: everything `log.log` did becomes a `s:log` event or a span
attribute, now correlated and timed.

Do not preserve both "logs" and "spans" as long-term first-class APIs. The
destination is one instrumentation API, not two parallel habits.

## Phase 2 (enabled by this, not built now)

A `log "message"` (or `log("message", { ... })`) builtin in the `.fuwa` DSL that
lowers to `trace.log(...)`, so debugging the DSL logic we author is one keyword.
The span infrastructure makes this trivial to add later. It is **not** in scope
now because wrapping each action/route execution in a `request`/`db`/`render` span
already shows "action ran, called db, took Xms, returned Y" without any new
syntax — most of the value for none of the language surface.

## Non-goals — the YAGNI fence

We are explicitly **not** building any of these until a concrete need forces them:

- OpenTelemetry / OTLP exporters, or any wire protocol.
- Sampling, rate limiting, or log levels beyond the two above (`info`, `debug`).
- Metrics: counters, gauges, histograms, percentiles.
- A handler/subscriber registry (attach/detach). One swappable sink only.
- Cross-process / `postMessage` trace propagation (worker + iframe).
- Instrumentation of the tenant iframe or browser-side code.
- A global top-level rescue / catch-all error handler.
- Log rotation, file management, or structured log shipping.
- Automatic instrumentation / monkey-patching. Spans are hand-placed.

Each of these can bolt on later without rework, precisely because emit is
decoupled from sink and spans are explicit. We add them the day we need them.

## Acceptance criteria

This is done, for the MVP, when:

1. `runtime/trace.lua` exists as one small module with `span`, `start`/`close`,
   `s:log`, `s:set`, an ambient current-span stack, and a no-op fast path when
   tracing is off.
2. `trace.emit` routes through a single swappable `trace.sink`; the dev server
   sets a stderr pretty-printer at boot; tests can set a capturing sink.
3. A span that raises records the failure and **re-raises** unchanged (verified by
   a test that asserts both the recorded event and the propagated error).
4. Every request emits one always-on canonical line with method, path, status,
   duration, and `trace_id`, regardless of `FUWA_TRACE`.
5. `FUWA_TRACE=db,compile` prefix scope selection works; `FUWA_TRACE=1`/`all`
   enables everything.
6. The current `log.log` call sites are migrated to spans and the trace tree for a
   real request reads like the example above, correlated by `trace_id`.
7. Comprehensive unit tests cover: span nesting/trace id inheritance, the no-op
   path (no output when disabled), scope filtering, error re-raise + recording,
   and the canonical line contents.

## Risks

- **Ambient state under future concurrency.** Safe today (fork-per-connection);
  will not be safe in the async worker. Documented as an out-of-scope boundary so
  nobody accidentally relies on ambient propagation there.
- **Scope creep into a platform.** Mitigated by the non-goals fence. Any PR that
  reaches for an item on that list needs an explicit decision first.
- **Noise.** Too many span sites makes the tree unreadable. Instrument seams, not
  every function; add spans in response to real debugging needs.
```
