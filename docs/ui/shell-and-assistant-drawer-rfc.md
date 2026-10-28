# RFC — the fuwa shell and the assistant drawer

> Status: **Implemented.** This describes the shell UI as it exists on this
> branch: what it does, the contracts it holds, how it is built, how it is
> configured, how to verify it, and what it deliberately does not do.

The shell is the `fuwa` application layer: a server-rendered `.fuwa` document
that compiles to Lua, runs the app runtime in a Wasmoon Web Worker, and renders
through petite-vue + htmx + UnoCSS. Its job is to be the one place an operator
looks at a cluster: preview, code, terminal, observability, and an assistant
that can answer questions about all of it.

## 1. What it does

| Surface | What the operator gets |
|---|---|
| **Preview stage** | The running app payload in a sandboxed iframe, with its own runtime worker and SQLite-WASM state. |
| **Editor** | CodeMirror over the payload's `.fuwa` files, with local Lua highlighting. |
| **Terminal** | A `tmux\|debug` pane that streams **Kubernetes pod logs**, filtered or unfiltered. |
| **Observability** | Live trace SSE plus panel links to Grafana, Cilium/Hubble, Argo CD, Kargo, Neo4j, Sandboxes. |
| **Assistant drawer** | A chat/investigate drawer that talks to the cluster assistant, renders its answers, and routes its evidence links back into the panel. |
| **Panels** | One right-hand iframe panel. Everything that would normally be a new tab opens here instead. |

The organising rule: **nothing in the shell is allowed to open a tab.** A deep
link, a dashboard button, or a link inside an assistant answer is rewritten onto
a same-origin proxy and shown in the panel.

## 2. The contract

### 2.1 Shell document

Server-rendered by `runtime/host/dashboard.lua` → `Dashboard.build(host, …)`
returns the data table the templates interpolate (`&dashboard.*`). The document
is `shell/views/layout.fuwa`; the body is `shell/views/fragments/home.fuwa` plus
`workspace.fuwa`, with `workspace-oob.fuwa` for htmx out-of-band swaps.

petite-vue is mounted on the **stable parent**:

```
section#shell-content                      ← never replaced by htmx
  div.ide-shell[v-scope="FuwaShellWorkspace.createState()"]
```

State that must survive a swap lives above the swapped subtree. This is why the
assistant transcript is buffered in JS rather than in the fragment: an htmx view
swap replaces the DOM, not the scope.

### 2.2 Assistant transport

Every assistant route is reachable under `/assistant/` with the prefix stripped,
so the browser only ever talks to one origin:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/assistant/` | the assistant's own UI (fallback page) |
| `GET` | `/assistant/healthz` | liveness probe on drawer open |
| `GET` | `/assistant/metrics` | Prometheus text, per-LLM-stage |
| `POST` | `/assistant/ui/message` | HTML fragment for the chat thread |
| `POST` | `/assistant/chat` | one-shot JSON reply |
| `POST` | `/assistant/investigate` | plan → fan-out → correlate JSON |
| `POST` | `/assistant/plan` | planner debug (`qwen` \| `laya`) |
| `POST` | `/assistant/speak` | Kokoro TTS → `audio/wav` |
| `POST` | `/assistant/voice/transcribe` | STT |
| `GET` | `/assistant/actions` | tool catalog + pending confirmations |
| `POST` | `/assistant/actions/request` | mint a confirmation token |
| `POST` | `/assistant/actions/confirm` | execute a confirmed action |
| `GET` | `/assistant/audio/{id}` | `202` while synthesizing, `200` when ready |

`/assistant-gpu/` is the **same contract** pointed at the GPU assistant, so the
drawer's CPU|GPU toggle changes which backend answers without changing its code.

### 2.3 Deep-link routing

The assistant emits absolute LoadBalancer URLs. Two of those cannot be framed
as-is — Argo CD refuses framing and only serves its SPA at `/` — so a click is
mapped onto fuwa's own proxy instead:

```
http://<argocd-lb>/applications/x   →  /argocd/     (path collapsed)
http://<kargo-lb>/projects          →  /kargo/projects  (path and query kept)
```

Everything else stays absolute and opens in the panel unchanged.

## 3. How it is implemented

### 3.1 Proxying (nginx)

Each external UI gets a prefixed, same-origin route. The pattern is identical in
all four cases:

```nginx
location /argocd/ {
    set $argocd_upstream "${ARGOCD_UPSTREAM}";
    rewrite ^/argocd/?(.*)$ /$1 break;      # a variable in proxy_pass disables
    proxy_pass http://$argocd_upstream;     # prefix replacement, so strip it
    proxy_hide_header X-Frame-Options;      # let it be framed
    sub_filter '<base href="/">' '<base href="/argocd/">';
}
```

Three details are load-bearing and easy to get wrong:

1. **`rewrite`, not prefix replacement.** A variable in `proxy_pass` disables
   nginx's automatic prefix stripping, so `/assistant/x` would arrive as
   `/assistant/x` and fall into the upstream's GET-only catch-all (a 405 on
   `POST`). The `rewrite … break` strips it explicitly.
2. **`proxy_hide_header` + `sub_filter`.** Framing-refusing UIs are made
   embeddable by dropping `X-Frame-Options` / `CSP`, and their hardcoded
   `<base href="/">` is rewritten to the prefix. For Kargo the *global*
   `window.__KARGO_BASE_PATH__` must be rewritten too — its React Router
   basename, REST base URL and redirects all read the global, so rewriting only
   `<base>` leaves the panel blank.
3. **Absolute API calls.** UIs that call `/api/v1` or `/v1beta1` get those paths
   proxied at fuwa's root as well, or they 404 against the shell.

### 3.2 Assistant drawer

`shell/hooks/workspace.js` owns transport only. The drawer renders the HTML that
`POST /assistant/ui/message` returns, with the assistant's own stylesheet ported
into `layout.fuwa`, so answers render exactly as the assistant wrote them
(markdown, evidence, metrics) instead of being re-drawn in petite-vue.

Behaviour that is pinned by tests:

- **Transcript survives view swaps** — buffered above the swapped subtree.
- **Cancel** — an in-flight question can be stopped, and the question is
  restored to the composer.
- **Backpressure** — `429 Retry-After` is honoured and the turn retried once.
- **Health** — probing on open; an offline assistant is stated, not silently
  typed into.
- **Session** — rotate and clear; refusing to rotate mid-request.
- **Level-2 actions** — `request` mints a token, `confirm` executes. The drawer
  never executes an action off a preview alone.
- **Fallback** — if the fragment endpoint is dead, the assistant's own page is
  embedded instead.
- **Links** — every assistant link opens the panel; no tab, and `javascript:`
  is refused.

### 3.3 Pod logs

`/__dev/pods/live` (`runtime/openresty/pods_live.lua`) resolves a slot's label
selector to a pod through the Kubernetes API and tails its log, multiplexed over
one SSE stream. `shell/hooks/tmux.js` renders the panes; it declares
`data-tmux-slot` and `data-tmux-selector` per pane rather than container names.

## 4. Configuration

The shell carries **no addresses of its own**. Endpoints come from the
environment, with the reference deployment's LAN as documented defaults.

**Panel endpoints** — `runtime/host/shell_config.lua`, rendered into `home.fuwa`
as `&dashboard.panels.*` bindings:

| Variable | Panel |
|---|---|
| `FUWA_PANEL_GRAFANA` | Grafana |
| `FUWA_PANEL_CILIUM` | Cilium / Hubble UI |
| `FUWA_PANEL_VICTORIAMETRICS` | VictoriaMetrics |
| `FUWA_PANEL_SANDBOXES` | Sandboxes |
| `FUWA_PANEL_NEO4J` | Neo4j Browser |
| `FUWA_PANEL_ARGOCD_HOST` | Argo CD LoadBalancer host (routed to `/argocd/`) |
| `FUWA_PANEL_KARGO_HOST` | Kargo LoadBalancer host (routed to `/kargo/`) |

The two *host* values are rendered as `data-panel-*-host` attributes on
`#shell-content` and read by `assistantLbRoutes()`; with no attribute, nothing
is remapped and the raw URL opens.

**Proxied upstreams** — substituted by the container entrypoint:

| Variable | Default | Route |
|---|---|---|
| `ASSISTANT_UPSTREAM` | `192.168.0.243` | `/assistant/` |
| `ASSISTANT_GPU_UPSTREAM` | `192.168.0.243` | `/assistant-gpu/` |
| `ARGOCD_UPSTREAM` | `192.168.0.247` | `/argocd/`, `/api/` |
| `KARGO_UPSTREAM` | `192.168.0.249` | `/kargo/`, `/v1beta1/` |
| `FUWA_K8S_DNS` | `10.43.0.10` | resolver for the pod-log API |
| `PORT`, `LUA_CODE_CACHE` | `8080`, `on` | listener, code cache |

`FUWA_SSL` and `FUWA_K8S` gate the `# --ssl-start/end` and `# --k8s-start/end`
blocks in `nginx.conf`: outside the cluster both blocks are stripped, so an
image built for k3s still boots under compose.

## 5. How to verify

```bash
make test              # Lua: compile-check + unit + smoke + acceptance + integration
make test-js           # the shell's JS glue in a stubbed DOM (13 suites)
make test-proxy        # live /assistant/ proxy check (needs a running fuwa)
```

The UI contract is covered by:

| Suite | Pins |
|---|---|
| `tests/unit/assistant_ui.lua` | drawer contract, link rewriting, action tokens, metrics parsing |
| `tests/unit/shell_layout.lua` | panel links live in the right headers |
| `tests/unit/shell_config.lua` | panel defaults + env override + no addresses in the templates |
| `tests/unit/k8s_gitops.lua` | Argo is a panel, never a tab |
| `tests/js/assistant_*.mjs` | behaviour: routing, scope, session, cancel, backpressure, health, metrics, plan, actions, links, transcript, fallback, backend |

## 6. Limits and follow-ups

- **The reference LAN is the default.** Override the variables above before
  deploying anywhere else; otherwise the panel buttons point at
  `192.168.0.x`. They are addresses, not secrets, but they are one network's.
- **`/api/` is claimed by Argo CD.** A second embedded UI that needs a different
  absolute `/api` would need a prefix of its own.
- **Sub-filtering is fragile by nature.** It depends on the upstream's exact
  HTML (`<base href="/">`, `window.__KARGO_BASE_PATH__`). A vendor change to
  either string silently un-embeds the panel, so each proxy route deserves the
  live check in `make test-proxy` when its vendor is upgraded.
- **One panel, one iframe.** Two dashboards cannot be open side by side.
- **The image does not ship tests.** `.dockerignore` excludes `tests/` and
  `docs/`, so the baked `/app` has no test path; run the suites from a checkout.
