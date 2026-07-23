# Fuwa Vector Bridge Implementation Plan

Date: 2026-07-23

## Goal

Add an `/infra` folder to `fuwa` that contains the observability stack wiring
copied from `shop` and adapted for `fuwa`.

The app-side change stays minimal:

- keep existing `fuwa` telemetry
- do not add OpenTelemetry
- do not add new services
- do not move runtime logic into `/infra`
- only bridge existing telemetry into Vector over HTTP

## Code Truth: `fuwa`

Existing telemetry is emitted from structured Lua event tables in
`runtime.trace`, then formatted to stderr by the sink:

- `runtime/trace.lua`
- `runtime/log.lua`
- `runtime/fuwa-dev.lua`

The request-close event already carries the fields we need for the first bridge:

- `kind = "request"`
- `trace_id`
- `method`
- `path`
- `status`
- `duration_ms`
- `failed`
- `error`

Important constraint from code:

- `fuwa` currently records request `path`, not a normalized route template
- `.fuwa` actions do not emit payload/business telemetry today
- the current useful bridge target is runtime telemetry only

## Code Truth: `shop`

Reusable observability pieces already exist in `shop`:

- `docker-compose/observability.yml`
- `docker-compose/vector.toml`
- `docker-compose/clickhouse/init/001-otel.sql`
- `docker-compose/clickhouse/config.d/001-mvp.xml`

Actual stack from code:

- `vector-router`
- `victoriametrics`
- `clickhouse`
- `uptrace`

Actual ports from code:

- Vector API in copied `shop` config: `8686`
- Vector HTTP source candidate for `fuwa`: `8687`
- Vector OTLP gRPC: `4317`
- Vector OTLP HTTP: `4318`
- VictoriaMetrics: `8428`
- ClickHouse HTTP: `8123`
- ClickHouse native: `9000`
- Uptrace: `14317`, `14318`

## Chosen Bridge

Bridge shape:

1. Keep `fuwa` telemetry generation unchanged.
2. Intercept only the existing request-close event.
3. Convert that event into one JSON document.
4. POST that JSON to a Vector `http_server` source on `vector-router:8687`.
5. In Vector:
   - keep the event as a log-like row for ClickHouse
   - derive metrics from the same event for VictoriaMetrics

This keeps the first step wide and simple:

- one event per completed request
- one source in Vector
- one log path
- one metric path

## Planned `fuwa` `/infra` Layout

```text
infra/
  docker-compose/
    observability.yml
    vector.toml
    clickhouse/
      init/
        001-otel.sql
      config.d/
        001-mvp.xml
```

The app runtime code stays outside `/infra`.

## Implementation Steps

### 1. Copy the observability stack into `fuwa/infra`

Copy and adapt from `shop`:

- `docker-compose/observability.yml`
- `docker-compose/vector.toml`
- `docker-compose/clickhouse/init/001-otel.sql`
- `docker-compose/clickhouse/config.d/001-mvp.xml`

Adapt service naming only where needed for `fuwa`.

### 2. Add one Vector HTTP source

Add a new `http_server` source listening on `:8687`.

Requirements:

- accept JSON POSTs from `fuwa`
- keep the payload schema simple and flat
- route into both the log and metric branches

### 3. Shape `fuwa` request events into the `shop` pipeline

Use one remap transform to:

- normalize the incoming `fuwa` request event
- preserve the full event in JSON for ClickHouse
- add small helper numeric fields for metric extraction

Expected log branch target:

- existing ClickHouse log sink and `otel.otel_logs` table shape

Expected metric branch target:

- existing VictoriaMetrics remote write sink

### 4. Add the minimal app bridge

In `fuwa`, add a minimal sink-side forwarder that:

- runs only for `event.kind == "request"`
- serializes one JSON payload
- posts asynchronously to `http://vector-router:8687/...`
- never fails the request when Vector is unavailable

The default local sink output should remain visible during development.

### 5. Validate the bridge end to end

Validation checklist:

1. Start `infra/docker-compose/observability.yml`
2. Run `fuwa`
3. Trigger a few requests
4. Confirm Vector accepts POSTs
5. Confirm ClickHouse receives log-like rows
6. Confirm VictoriaMetrics receives request metrics
7. Confirm Uptrace stays available on top of ClickHouse

## First Payload Scope

The first payload should represent a completed request only.

Fields to keep in the first version:

- `timestamp`
- `service`
- `kind`
- `trace_id`
- `method`
- `route`
- `status`
- `duration_ms`
- `error`

`route` will initially be the current request path because that is what `fuwa`
telemetry already has.

## Non-Goals

Explicitly out of scope for the first pass:

- OpenTelemetry in `fuwa`
- payload/business telemetry
- UI panels, dashboards, modals, terminal commands
- querying VictoriaMetrics or ClickHouse from the app
- APM-style custom frontend
- schema redesign beyond what the reused `shop` stack already needs
- broad runtime refactors

## Discussion Items For The Next Pass

Two Vector-pipeline topics are worth discussing after the first bridge works:

1. Cardinality control for `route` and error labels before remote write
2. Whether we want to forward only request-close events or also selected
   non-request spans such as `compile`, `render`, and `db.*`
