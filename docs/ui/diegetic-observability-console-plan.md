# Plan: Diegetic Observability Console for the Shell

Status: design. No code in this document. This is the implementation plan for
replacing the current observability tab with a dense, request-centric, diegetic
console that belongs inside the fuwa shell instead of imitating a dashboard.

Read alongside:

- [docs/refactoring/shell-architecture.md](/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/shell-architecture.md)
- [docs/guidelines/08-telemetry-and-debugging.md](/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/08-telemetry-and-debugging.md)
- [docs/refactoring/telemetry-plan.md](/mnt/DATA/development/projects/repos/fuwa/docs/refactoring/telemetry-plan.md)

## Why this exists

The current observability tab proves that traces can move from Lua to the Python
dev server and from the dev server to the browser. That part is useful.

The current UI is not.

It has four concrete failures:

1. It looks like a miniature dashboard, not a shell-native developer surface.
2. It gives too much visual weight to low-value summaries and too little to
   "what just happened?" activity.
3. It shows raw or flattened telemetry in ways that destroy trust, especially
   when incomplete or stale.
4. It treats details as always-visible furniture instead of on-demand context.

This document defines the correct product shape so future implementation does not
fall back into generic "admin panel" or "AI dashboard" habits.

## The product thesis

The observability tab is **not** a second monitoring product.

It is a **developer console embedded in the shell**. Its job is to help someone
building a `.fuwa` payload answer these questions with minimal eye movement:

1. Is the local stack alive?
2. What request just happened?
3. Was it slow?
4. Was it compile or render that was slow?
5. If something broke, can I expand exactly one item and inspect it?

That is the entire scope.

Anything beyond that must justify itself against those five questions.

## Non-goals

Explicitly do not build:

- A Grafana clone
- A permanent right-hand trace inspector pane
- Big metric cards that dominate the layout
- Raw event dumps as the default view
- A custom trace waterfall
- Query builders for VictoriaMetrics or ClickHouse
- Alerting, SLOs, burn-rate UI, or policy surfaces
- Any feature that exists mainly to look "platform-y" in screenshots

## The design rules

These rules are mandatory for the implementation.

### 1. Request-centric, not event-centric

The primary unit is a **completed request**.

Not:

- span start
- span end
- raw log event
- arbitrary trace fragment

The default list must show one row per completed request, newest first.

### 2. Summary rails stay thin

Health and pulse information are supporting context, not the main act.

They belong in thin inline rails at the top, not in card stacks.

### 3. Details are collapsed by default

The user should not see a permanent "request focus" panel.

Details should appear only when the user explicitly asks:

- click a row to expand inline, or
- click a chevron to open a drawer

Default state is summary-only.

### 4. Live activity pushes; coarse summaries poll

Transport rule:

- activity stream: push via SSE
- health probes: poll
- aggregate pulse: poll

If a new trace event arrives, the visible request list must update without a tab
switch, manual refresh, or hidden remount.

### 5. No stale visible state

If the panel is visible, it must either:

- be live, or
- clearly show a reconnecting/error state

It must never silently display frozen data with a normal-looking UI.

### 6. The shell voice wins

This surface lives in the shell.

Use:

- dense rows
- monospace where appropriate
- concise labels
- the shell's existing visual language

Do not introduce:

- enterprise dashboard visual metaphors
- oversized KPI blocks
- decorative empty chrome

## The correct information hierarchy

Top to bottom:

1. `STACK` rail
2. `FLOW` rail
3. `RECENT ACTIVITY` request list
4. Optional per-request expansion
5. Small footer for stream/buffer state

Notably absent:

- no permanent "Pulse" section heading
- no permanent "Request Focus" panel

## Correct ASCII: baseline layout

This is the canonical target.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ OBSERVABILITY                                        live request console  │
│                                                            [ Uptrace ↗ ]  │
├────────────────────────────────────────────────────────────────────────────┤
│ stack   vector ◉   vm ◉   clickhouse ◉   uptrace ◉                        │
├────────────────────────────────────────────────────────────────────────────┤
│ flow    recent 12   errors 0.0%   p95 72ms   latest 0.4s ago   live ●     │
├────────────────────────────────────────────────────────────────────────────┤
│ recent activity                                                            │
│                                                                            │
│ ▸ POST /switch/fuwa-gomen                        200                 86ms   │
│   compile 40ms · render 40ms                                           │   │
│                                                                            │
│ ▸ GET /favicon.ico                                200                 33ms  │
│   compile 24ms · render 6ms                                            │   │
│                                                                            │
│ ▸ GET /                                          200                 60ms   │
│   compile 25ms · render 30ms                                           │   │
│                                                                            │
│ ▸ GET /buy/onigiri                               200                 44ms   │
│   compile 12ms · render 18ms                                           │   │
│                                                                            │
│ ▸ GET /buy/ramen                                 500                2.1s   │
│   compile 18ms · render 14ms · action failed                            │   │
├────────────────────────────────────────────────────────────────────────────┤
│ ( •ω•)ﾉ✧ obs ready · live ● · buffered 26 events                          │
└────────────────────────────────────────────────────────────────────────────┘
```

This is the default closed state.

Everything important is readable in one scan:

- stack alive?
- current flow?
- latest requests?
- slow or failing request?

## Correct ASCII: expanded request row

When a row is expanded, only that row grows.

The rest of the list stays visible.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ recent activity                                                            │
│                                                                            │
│ ▾ POST /switch/fuwa-gomen                        200                 86ms   │
│   compile 40ms · render 40ms                                           │   │
│                                                                            │
│   trace trace_6a62c672_2                                                  │
│   ├─ compile   40.1ms   files=19 modules=3                                │
│   ├─ render    40.1ms   bytes=23186                                       │
│   └─ request   86.1ms   status=200                                        │
│                                                                            │
│   log                                                                      │
│   ▶ request method=POST path=/switch/fuwa-gomen                           │
│   ▶ compile files=19                                                      │
│   · scanning source files=19                                              │
│   · emitted modules count=3                                               │
│   ◀ compile files=19 modules=3 40.1ms                                     │
│   ▶ render method=POST path=/switch/fuwa-gomen                            │
│   ◀ render bytes=23186 40.1ms                                             │
│   ◀ request POST /switch/fuwa-gomen status=200 86.1ms                     │
│                                                                            │
│ ▸ GET /favicon.ico                                200                 33ms  │
│ ▸ GET /                                          200                 60ms   │
└────────────────────────────────────────────────────────────────────────────┘
```

This is the correct detail strategy:

- details exist
- details are useful
- details are not always visible

## Correct ASCII: mobile-width fallback

At narrower widths the tab becomes one column.

```text
┌──────────────────────────────────────────────────────┐
│ OBSERVABILITY                     [ Uptrace ↗ ]      │
├──────────────────────────────────────────────────────┤
│ stack   vector ◉ vm ◉ clickhouse ◉ uptrace ◉        │
│ flow    recent 12 · error 0.0% · p95 72ms · live ●  │
├──────────────────────────────────────────────────────┤
│ recent activity                                      │
│                                                      │
│ ▸ POST /switch/fuwa-gomen       200           86ms   │
│   compile 40ms · render 40ms                        │
│                                                      │
│ ▸ GET /favicon.ico               200           33ms  │
│   compile 24ms · render 6ms                         │
│                                                      │
│ ▾ GET /                         200           60ms   │
│   compile 25ms · render 30ms                        │
│   trace trace_...                                     │
│   ├─ compile 25ms files=19                          │
│   └─ render 30ms bytes=36851                        │
│                                                      │
│   log                                                │
│   ▶ request method=GET path=/                       │
│   ▶ compile files=19                                │
│   ◀ render bytes=36851 30.5ms                       │
│                                                      │
├──────────────────────────────────────────────────────┤
│ obs ready · live ● · buffered 26 events             │
└──────────────────────────────────────────────────────┘
```

## Why the current bad version fails

These are the specific antipatterns to avoid.

### Bad pattern 1: faux-dashboard cards

Bad:

```text
[ Requests ]
[ Error Rate ]
[ p95 Latency ]
```

Why it fails:

- wastes vertical space
- lowers density
- feels detached from the shell
- makes the user scroll sooner

Correct replacement:

```text
flow   recent 12   errors 0.0%   p95 72ms   latest 0.4s ago   live ●
```

### Bad pattern 2: always-visible inspector pane

Bad:

```text
RECENT ACTIVITY | REQUEST FOCUS
```

Why it fails:

- halves the useful width of the list
- creates permanent noise
- forces details even when none are needed
- looks like a desktop tracing tool rather than a shell-native surface

Correct replacement:

- one-column activity list
- inline expandable details

### Bad pattern 3: raw event list as the main view

Bad:

```text
-- -- 200
-- -- 200
GET / 200
```

Why it fails:

- mixes incomplete and complete events
- breaks trust immediately
- forces the user to reverse-engineer event semantics

Correct replacement:

- only completed requests in the default list
- optional nested details for the underlying stages/logs

### Bad pattern 4: stale visible state

Bad:

- stream closed
- UI still visible
- health looks dead
- footer says paused

Why it fails:

- user assumes stack is broken
- root cause is actually widget lifecycle
- destroys confidence in the tool

Correct replacement:

- if visible, stream should be live or explicitly reconnecting
- lifecycle must be rooted in visibility, not stale mount assumptions

## Data model

The frontend must use a request-centric shape.

### Activity row

```json
{
  "trace_id": "trace_6a62c672_2",
  "method": "POST",
  "path": "/switch/fuwa-gomen",
  "status": 200,
  "duration_ms": 86.1,
  "compile_ms": 40.1,
  "render_ms": 40.1,
  "failed": false,
  "summary": "compile 40ms · render 40ms"
}
```

### Expanded detail

```json
{
  "trace_id": "trace_6a62c672_2",
  "stages": [
    { "name": "compile", "duration_ms": 40.1, "detail": "files=19 modules=3" },
    { "name": "render", "duration_ms": 40.1, "detail": "bytes=23186" }
  ],
  "logs": [
    "▶ request method=POST path=/switch/fuwa-gomen",
    "▶ compile files=19",
    "· scanning source files=19",
    "· emitted modules count=3",
    "◀ compile files=19 modules=3 40.1ms",
    "▶ render method=POST path=/switch/fuwa-gomen",
    "◀ render bytes=23186 40.1ms",
    "◀ request POST /switch/fuwa-gomen status=200 86.1ms"
  ]
}
```

### Summary rails

```json
{
  "stack": {
    "vector": { "up": true, "latency_ms": 12 },
    "vm": { "up": true, "latency_ms": 9 },
    "clickhouse": { "up": true, "latency_ms": 17 },
    "uptrace": { "up": true, "latency_ms": 14 }
  },
  "flow": {
    "recent_requests": 12,
    "error_rate": "0.0%",
    "p95_label": "72ms",
    "latest_label": "0.4s ago",
    "stream_label": "live"
  }
}
```

## Transport model

Use mixed transport on purpose.

### SSE for live activity

Use SSE for the activity stream because it is temporal and append-oriented.

Endpoint shape:

```text
GET /__dev/traces/live

event: ready
data: {"ok":true}

event: trace
data: {"kind":"request", ...}
```

Rules:

- the visible list must update immediately when a request-complete event arrives
- keepalive comments are acceptable
- reconnects must be automatic

### Polling for stack health

Poll every 10-30 seconds:

- `/__dev/proxy/vector/health`
- `/__dev/proxy/vm/health`
- `/__dev/proxy/clickhouse/ping`
- `/__dev/proxy/uptrace/`

These are not event streams and do not benefit from SSE.

### Polling for coarse flow metrics

The flow rail can be derived from the recent request buffer or polled from a
compact summary endpoint. Either approach is acceptable as long as it does not
add a second competing source of truth for the activity list.

Preferred short-term approach:

- derive `recent`, `errors`, and `p95` from the same recent request buffer used
  by the activity list

## Correct lifecycle model

This is one of the most important parts.

### The rule

If the obs tab is visible:

- SSE must be connected or reconnecting
- polling timers must be running
- the footer must reflect actual state

If the obs tab is hidden:

- SSE may disconnect
- polling may stop

### What must never happen

- visible panel + closed stream + no reconnect
- hidden internal pause state with visible stale UI
- health rails defaulting to "down" because the widget was unmounted, not because
  the services failed

### Implementation requirement

The widget lifecycle must be driven by:

- actual view visibility
- actual DOM root presence

Not by:

- one-time boot assumptions
- stale app object existence
- generic global swap handlers that do not check whether the obs tab is active

## Interaction model

### Default state

- top rails visible
- request list visible
- all rows collapsed
- newest request first

### Click row

- toggle expansion inline
- close previously expanded row only if single-expand mode is chosen
- keep scroll position stable

### Auto-follow

When new requests arrive:

- if no row is expanded, new rows append/prepend naturally
- if one row is expanded, keep it expanded unless the user closes it

Do not steal focus or force-open the latest request.

### Empty state

Correct empty state:

```text
No completed requests yet. Trigger a route to populate the live stream.
```

Do not show:

- generic "No traces yet"
- blank list with no explanation

## Visual language

Use:

- small uppercase labels only where useful
- monospace for activity and logs
- tabular numerals for durations/statuses
- thin borders
- low-chrome rails
- compact rows

Avoid:

- large boxes for single numbers
- oversized headings
- symmetric "cards" everywhere
- giant dead zones in the panel

## Anti-slop checklist

Before shipping, review the implementation against this checklist.

### Layout

- No three-card metric row
- No permanent detail pane
- No section that exists only to hold one line of text
- No duplicated labels such as "Live Metrics" and "Pulse" for the same thing

### Semantics

- Default list shows only completed requests
- No `-- -- 200` style broken rows
- Each row answers method, path, status, total duration, and stage summary

### Lifecycle

- While visible, stream is live or reconnecting
- While hidden, stale state is not silently left behind
- Health red means backend failure, not widget pause

### Density

- A developer can scan five recent requests without scrolling
- Summary rails occupy less space than the old card stack
- Expanded details do not erase the surrounding list context

### Tone

- The surface looks like part of the shell
- It does not look like a generic admin product
- It does not require explanation to understand what just happened

## Implementation phases

### Phase 0: stop the bleeding

Goal:

- remove obviously wrong UX and stale-state behavior

Tasks:

1. Remove the permanent right-hand focus pane.
2. Remove the `PULSE` section heading and convert it to an inline flow rail.
3. Ensure the footer/stream state cannot remain "paused" while the panel is
   visible.
4. Ensure health rails do not paint red merely because the widget lifecycle
   stopped.

Acceptance:

- no always-visible detail pane
- no stale paused footer while tab is visible

### Phase 1: request-centric list

Goal:

- make the main list trustworthy and readable

Tasks:

1. Reduce the default stream to completed requests only.
2. Derive a compact stage summary per request.
3. Sort newest first.
4. Cap visible rows to a sane buffer size.
5. Keep activity rows compact and monospace.

Acceptance:

- every visible row corresponds to one completed request
- no broken placeholder rows

### Phase 2: inline expansion

Goal:

- preserve detail without burning half the surface

Tasks:

1. Add per-row expansion.
2. Render stages inline under the expanded row.
3. Render the recent event log inline under the expanded row.
4. Keep collapsed rows visible above/below the expanded row.

Acceptance:

- details exist only on demand
- expanded state is readable and bounded

### Phase 3: transport hardening

Goal:

- make live updates trustworthy

Tasks:

1. Keep SSE for activity.
2. Keep polling for stack health.
3. Reconnect SSE automatically.
4. Surface reconnecting state explicitly.
5. Add a test/probe that confirms a real request produces a visible live update.

Acceptance:

- when a trace is emitted, the frontend updates without user intervention

### Phase 4: browser-runtime parity

Goal:

- ensure payload interactions that produce traces also feed this surface

Tasks:

1. Audit whether all relevant interactions flow through the same dev-server
   trace pipeline.
2. If the browser runtime emits traces through a separate path, bridge them into
   the same UI-visible event stream.
3. Keep one frontend surface with one consistent activity model.

Acceptance:

- if a trace exists anywhere in local dev, the visible activity console updates

## Concrete file-level implementation map

This is the expected code ownership split.

### `runtime/dev-server.py`

Responsibilities:

- SSE endpoint for trace tail
- ring buffer snapshot endpoint
- backend health proxying

Must not grow into:

- UI formatting logic
- request summarization policy

### `shell/hooks/observability.js`

Responsibilities:

- connect/disconnect lifecycle
- reduce raw events into request summaries
- derive flow rail numbers
- expand/collapse interaction state

Must not grow into:

- dashboard framework
- duplicated transport clients for the same data source

### `shell/views/fragments/workspace.fuwa`

Responsibilities:

- shell-native structure
- collapsed activity list
- inline expanded detail markup

Must not contain:

- always-visible inspector pane
- giant metric card wrappers

### `shell/views/layout.fuwa`

Responsibilities:

- compact rail styles
- activity row styles
- expansion styles

Must avoid:

- ornamental empty chrome
- dashboard-card defaults

## Test plan

### String/smoke tests

At minimum assert:

- the obs view says `live request console`
- the default list is `Recent Activity`
- there is no permanent `Request Focus` pane
- the hook uses SSE for `/__dev/traces/live`
- Uptrace participates in stack health

### Behavior checks

Add explicit verification for:

1. A request appears in the activity list when a real shell request completes.
2. Expanding a row reveals stages and event log inline.
3. Hiding the tab does not leave false-red health when shown again.
4. Reconnecting SSE surfaces `reconnecting` rather than silently freezing.

### Manual verification

Use this sequence:

1. Open obs tab.
2. Trigger `GET /`.
3. Confirm a new row appears immediately.
4. Trigger `/switch/fuwa-gomen`.
5. Confirm a new row appears immediately.
6. Expand the row.
7. Confirm compile/render stages and logs appear inline.
8. Temporarily break one backend health probe.
9. Confirm only that stack item goes red.
10. Restore it and confirm recovery.

## Final acceptance criteria

The redesign is done when all of these are true:

1. The top of the tab is two thin rails, not a card dashboard.
2. The main body is a request list, not a raw trace dump.
3. New request-complete events appear live without manual refresh.
4. Per-request details are collapsed by default and expandable inline.
5. Visible red status means a real backend failure, not a widget lifecycle bug.
6. The UI reads like part of the fuwa shell instead of a generic admin panel.

## The one-sentence heuristic

If a platform engineer can answer "what just happened and was it compile or
render?" in one glance, the design is correct.

If they have to decode widgets, cards, panes, or raw event fragments first, it
is wrong.
