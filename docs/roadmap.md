# Roadmap

> What this repository is, what has shipped, what is next, and what is
> knowingly unfinished. For the design of the shell UI specifically, see
> [`docs/ui/shell-and-assistant-drawer-rfc.md`](ui/shell-and-assistant-drawer-rfc.md).

fuwa is the `.fuwa` application layer: a DSL- authored application that compiles
to Lua, runs its runtime in a Wasmoon Web Worker, and renders through
petite-vue + htmx + UnoCSS. The production platform around it (SvelteKit shell,
tenant backend) is private; this repo stands on its own.

## Shipped

### Runtime and compiler

- **`.fuwa` → Lua compiler** with a strict compiler boundary: `compiler.core`
  knows nothing about the dev server, HTTP, workers or the TS host.
- **In-browser execution** through a Wasmoon worker, with SQLite-WASM
  persistence (`sqlite_local` provider).
- **File watching + live reload** over SSE, so an edit recompiles and re-renders
  without a restart.
- **Tracing pipeline** with a shared sink, a router, and a **native OTLP
  adapter** for traces, metrics and logs — no Vector sidecar.

### Delivery

- **k3s deployment** as plain manifests under `infra/k8s/`, packaged with
  Kustomize and reconciled by **Argo CD** (`infra/k8s/argocd/`).
- **Self-contained image**: the source tree is baked into `/app`, so no bind
  mount is required. `ARG BASE_IMAGE` allows a rebuild from a local registry
  when Docker Hub's anonymous quota is exhausted.
- **In-namespace observability**: Tempo, Loki and an OTel collector, plus
  additive Cilium network policies for the fuwa ↔ observability path.
- **One config surface**: every upstream and panel endpoint is environment
  driven; `FUWA_SSL` and `FUWA_K8S` gate the TLS and cluster-only nginx blocks,
  so an image built for k3s still boots under compose.

### Shell UI

- **Panel model** — one right-hand iframe; dashboards, Argo CD, Kargo, Neo4j and
  the assistant's evidence links all open there, never in a tab.
- **Assistant drawer** — native chat/investigate over the same-origin
  `/assistant/` proxy, with CPU|GPU backend switching, transcript survival
  across htmx swaps, cancellation, `429 Retry-After` backpressure, health
  probing, metrics, planner debug, and confirmation-gated level-2 actions.
- **Pod-log terminal** — Kubernetes pod logs streamed over one multiplexed SSE
  endpoint and selected by label.
- **Config-driven endpoints** — the shell templates carry no addresses; panels
  come from `runtime/host/shell_config.lua`.

### Project hygiene

- **MIT licence** (`LICENSE`).
- **CI**: compile-check, luacheck (advisory), unit, smoke, acceptance,
  integration, a Docker boot check, and an infra check.
- **Test suites**: Lua unit suites under `tests/unit/` (17 files, **12 wired
  into `make test-unit`**), smoke/acceptance/integration, and 13 behavioural JS
  suites for the shell's glue.

## Next

Ordered by what unblocks the most.

1. **Authenticate the proxy routes.** `/argocd/`, `/api/`, `/kargo/` and
   `/v1beta1/` forward to their upstreams with no auth of their own, and the
   framing headers are stripped so the panels can embed. Anything that can
   reach fuwa can reach those APIs. Argo's own auth still applies, but the
   proxy is an unauthenticated hop and should not stay one.
2. **Multi-panel / split view.** Today one iframe is open at a time; comparing
   two dashboards means closing one.
3. **Per-tenant endpoints.** `shell_config` is process-wide. A tenant that
   points at a different cluster needs the config to become per-request.
4. **Verify sub-filter contracts in CI.** The embedding of Argo/Kargo depends on
   exact vendor strings (`<base href="/">`, `window.__KARGO_BASE_PATH__`). A
   pinned fixture per upstream would catch a vendor upgrade that silently
   un-embeds a panel.
5. **Promote `make test-js` into CI.** It is opt-in today; it is the only
   coverage of the shell's JS glue, which is where most of the UI behaviour
   lives.
6. **Wire the five orphaned unit suites into `make test-unit`.** `tests/unit/`
   holds 17 suites but only 12 are listed in `UNIT_TESTS`, so
   `browser_deploy`, `fuwa_gomen_layout`, `openresty_deploy_store`,
   `openresty_preview_db_bridge` and `openresty_request_body` pass locally and
   never run in CI. They are green today; they should be gated.

## Known limitations

- **The reference LAN is baked in as defaults.** The panel and upstream
  variables default to `192.168.0.x`. They are addresses, not secrets, but a
  fresh deployment must override them. See the RFC's configuration table.
- **`/api/` belongs to Argo CD.** A second embedded UI needing a different
  absolute `/api` would need its own prefix.
- **The image ships without tests.** `.dockerignore` excludes `tests/` and
  `docs/`; run the suites from a checkout.
- **Single-writer runtime.** The runtime owns one SQLite file and a file
  watcher, so the Deployment is deliberately `replicas: 1` with a `Recreate`
  strategy. Scaling out needs a different persistence story first.
- **Compose is a fallback, not a target.** The compose files still exist and the
  entrypoint strips the cluster-only blocks, but k3s is the supported path; the
  compose dashboards (SigNoz, VictoriaMetrics, ClickHouse, Vector) are no longer
  proxied by `nginx.conf`.

## Running it

```bash
make test          # Lua: compile + unit + smoke + acceptance + integration
make test-js       # shell JS behaviour (opt-in, needs node)
make test-proxy    # live /assistant/ proxy check (needs a running fuwa)

# image
docker build -t fuwa-openresty -f infra/Dockerfile.openresty .
```

Cluster deployment lives in [`infra/k8s/README.md`](../infra/k8s/README.md).
