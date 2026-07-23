# Fuwa Infra Next Steps

Date: 2026-07-23

## Current State

What exists today in this repo:

- observability stack under `infra/docker-compose/`
- `fuwa` request telemetry bridge in `runtime/host/vector_bridge.lua`
- Vector ingest on `:8687`
- Vector API on `:8686`
- local `fuwa` runtime still started by `./dev.sh`

What does **not** exist today:

- no `openresty` service ported from `shop`
- no `Tiltfile` ported from `shop`
- no `fuwa` app container
- no single compose file that boots both the app and the observability stack

This means the current result is:

- `docker compose` starts the observability services only
- `fuwa` still runs on the host machine
- telemetry is forwarded from host `fuwa` to the Dockerized Vector endpoint

## What Was Not Ported

The following `shop` pieces were intentionally not copied in the first pass:

- `docker-compose/openresty/`
- `docker-compose/app.yml`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `Tiltfile`

Reason:

- the first pass was limited to the telemetry bridge and observability stack
- `shop`'s OpenResty layer is part edge proxy, part request-context/logging setup
- `fuwa` currently has its own Lua dev host in `runtime/fuwa-dev.lua` and `dev.sh`

## How To Run Today

Start the observability stack:

```bash
docker compose -f infra/docker-compose/observability.yml up -d
```

Run `fuwa` locally and forward request telemetry into Vector:

```bash
FUWA_VECTOR_URL=http://127.0.0.1:8687/ ./dev.sh
```

That gives us this shape:

- host `fuwa` on `http://localhost:8080`
- Dockerized Vector on `http://localhost:8687`
- Dockerized VictoriaMetrics on `http://localhost:8428`
- Dockerized ClickHouse on `http://localhost:8123`
- Dockerized Uptrace on `http://localhost:14318`

## Next Steps

If we want local behavior that is closer to the `shop` production shape, the work
falls into three steps.

### 1. Add a `fuwa` app container

Goal:

- run `./dev.sh` inside Docker
- connect it to `vector-router` by service name instead of host loopback

Result:

- `FUWA_VECTOR_URL=http://vector-router:8687/`
- one compose command starts the app and the observability stack together

### 2. Decide whether `openresty` belongs in the `fuwa` local stack

There are two possible reasons to bring it over:

- to mirror the `shop` edge layout more closely
- to reuse the request-context and JSON access-log pattern

There is one clear reason not to bring it over yet:

- `fuwa` already has a working Lua host, and adding `openresty` changes the runtime shape, not just the infra shape

So the decision point is:

- if we only need telemetry ingestion, `openresty` is not required
- if we want edge-like request handling and access-log parity with `shop`, then porting `docker-compose/openresty/` becomes relevant

### 3. Decide whether the `Tiltfile` is useful here

The `shop` repo does have a `Tiltfile`, but it was not needed for the first pass.

The practical question is simple:

- if `docker compose` plus `./dev.sh` is enough, we can ignore Tilt
- if we want one orchestrated local workflow with logs, rebuilds, and grouped services, then porting a simplified `Tiltfile` becomes useful

## Recommended Order

1. Add the `fuwa` app service to Compose first.
2. Validate end-to-end telemetry with all services on the Docker network.
3. Only then decide whether `openresty` adds something real for `fuwa`.
4. Treat the `Tiltfile` as optional orchestration work, not core telemetry work.

## Immediate Verification Target

The next concrete milestone is:

- one command starts `fuwa` plus the observability stack
- visiting `http://localhost:8080` generates request events
- Vector receives them on `:8687`
- ClickHouse stores the log rows
- VictoriaMetrics receives the derived metrics
- Uptrace remains reachable
