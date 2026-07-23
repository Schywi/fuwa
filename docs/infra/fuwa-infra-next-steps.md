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

## Environment Split

We need a hard split between what is useful for local development and what is
part of a deployment-shaped stack.

### Shared

These pieces make sense in both local and deployment-shaped setups:

- `infra/docker-compose/vector.toml`
- `infra/docker-compose/clickhouse/init/001-otel.sql`
- `infra/docker-compose/clickhouse/config.d/001-mvp.xml`
- Vector
- VictoriaMetrics
- ClickHouse
- Uptrace

### Dev Only

These are local workflow helpers:

- `./dev.sh`
- host-run `runtime/fuwa-dev.lua`
- manual `FUWA_VECTOR_URL=http://127.0.0.1:8687/ ./dev.sh`
- any future simplified `Tiltfile` used only to orchestrate local processes

### Prod Shaped

These are deployment-shape concerns:

- a containerized `fuwa` app service
- a single Compose stack that runs the app plus observability
- optional OpenResty edge in front of the app
- VPS-facing ports and reverse-proxy behavior

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

## Why OpenResty Can Change Runtime Shape

This needs a precise distinction.

### Case 1. OpenResty as a plain edge proxy

If OpenResty only does this:

- accept public HTTP
- proxy all app traffic to `fuwa`
- add request headers
- write access logs

then it is mostly an infrastructure addition.

In that shape, `fuwa` still remains the application runtime. OpenResty just sits
in front of it.

### Case 2. OpenResty as part of the application host

In `shop`, OpenResty does more than pass-through proxying. From the actual files:

- [docker-compose/openresty/nginx.conf](/mnt/DATA/development/projects/domains/shop/docker-compose/openresty/nginx.conf:1)
  sets rate limits, upstreams, request logging, and internal routes
- [docker-compose/openresty/lua/request_context.lua](/mnt/DATA/development/projects/domains/shop/docker-compose/openresty/lua/request_context.lua:1)
  creates request IDs and `traceparent`
- [docker-compose/openresty/lua/index.lua](/mnt/DATA/development/projects/domains/shop/docker-compose/openresty/lua/index.lua:1)
  renders a platform page directly from OpenResty

That means OpenResty there is not only "the web server." It is also:

- the source of edge correlation headers
- the source of edge JSON access logs
- the owner of some HTTP routes
- the internal proxy to Uptrace, Vector, and ClickHouse-backed helper routes

If we port **that** behavior into `fuwa`, we are no longer just adding infra. We
are changing who owns parts of the HTTP lifecycle.

That is the runtime-shape warning.

## What `fuwa` Owns Today

Today, `fuwa`'s own host already handles:

- raw request parsing in [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa-infra-exploration/runtime/fuwa-dev.lua:917)
- route dispatch and response building in [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa-infra-exploration/runtime/fuwa-dev.lua:799)
- shell routes, payload routes, assets, and reload SSE in [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa-infra-exploration/runtime/fuwa-dev.lua:1022)
- socket exposure through `socat` in [dev.sh](/mnt/DATA/development/projects/repos/fuwa-infra-exploration/dev.sh:25)

So if we add OpenResty in front of this, we need to choose clearly:

- keep `runtime/fuwa-dev.lua` as the app host and let OpenResty proxy to it
- or move some of that hosting responsibility into OpenResty

The first option is infra-first.
The second option is runtime-changing.

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

## Easiest Path vs Closer-To-Prod Path

There are two practical paths from here.

### Path A. Easiest: keep `fuwa` host as-is

Shape:

- Docker Compose runs observability
- `fuwa` runs with `./dev.sh`
- optional next step: containerize `fuwa` without introducing OpenResty yet

Why it is easier:

- it preserves the current `fuwa` request lifecycle
- it does not require re-expressing host behavior in nginx/lua
- it keeps telemetry debugging focused on the existing `fuwa` host

### Path B. Closer to `shop` prod: introduce OpenResty

Shape:

- OpenResty becomes the public entrypoint
- OpenResty proxies to a `fuwa` app service
- OpenResty owns edge headers and edge access logs

Why it is closer to prod:

- the network shape matches the `shop` deployment style more closely
- VPS deployment can terminate on OpenResty directly
- edge logs and request context become first-class

Why it is heavier:

- we need to define the proxy contract between OpenResty and `fuwa`
- we need to decide which routes remain in `fuwa` and which routes OpenResty owns
- we need to verify that dev-only host behavior like reload SSE still works cleanly through the edge

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
3. If we want VPS parity, add OpenResty as a proxy in front of the app service, not as a replacement for the app host.
4. Only after that decide whether any `shop` OpenResty-owned routes belong in `fuwa`.
5. Treat the `Tiltfile` as optional dev orchestration work, not core telemetry work.

## Immediate Verification Target

The next concrete milestone is:

- one command starts `fuwa` plus the observability stack
- visiting `http://localhost:8080` generates request events
- Vector receives them on `:8687`
- ClickHouse stores the log rows
- VictoriaMetrics receives the derived metrics
- Uptrace remains reachable
