# Feature: Assistant chat inside fuwa (in-panel deep links)

> Status: **Implemented.** Superseded the first native attempt: instead of
> re-drawing answers in petite-vue (which lost markdown, evidence, TTS and
> metrics), OpenResty proxies **every** assistant route under `/assistant/`
> (see `nginx.conf`) and the drawer renders the HTML that
> `POST /assistant/ui/message` returns, with the assistant's own stylesheet
> ported into `shell/views/layout.fuwa`. The drawer only owns transport and the
> fragment seams: evidence links → `openPanel`, 🔊 → `/assistant/speak`,
> copy → clipboard. Parity is pinned by `tests/unit/assistant_ui.lua` and the
> behaviour checks in `tests/js/` (`make test-js`).
> Two decisions taken after implementation: the transcript is buffered in JS so
> an htmx view swap does not lose the conversation, and the panel/upstream
> addresses are environment-driven rather than literals — see
> `runtime/host/shell_config.lua` and the configuration table in
> [`docs/ui/shell-and-assistant-drawer-rfc.md`](../../docs/ui/shell-and-assistant-drawer-rfc.md).
> Intended home: `experiments/research/features/`.

## Problem

fuwa embeds the assistant as a **cross-origin iframe** (`openDrawer(…:243)`).
The assistant renders its evidence "deep links" (Grafana Explore, Hubble, Neo4j)
as `<a href="…" target="_blank" rel="noopener">`, so **tapping one opens a new
browser tab** instead of the fuwa panel. A cross-origin iframe cannot be reached
by fuwa's JS, so the target cannot be rewritten — the click handler must live in
a document fuwa owns.

## What it does (goal)

The assistant's answers carry structured evidence; fuwa renders the chat
**natively** (not in an iframe) and turns each deep link / reproducible command
into a fuwa control that calls `openPanel(url)` (or `openDrawer`). Tapping a
Grafana/Hubble/Neo4j link opens it **inside fuwa**.

## The contract — assistant HTTP API

FastAPI/uvicorn, one process, one replica, port 8080.

| Method | Path | Body / query | Returns | Notes |
|---|---|---|---|---|
| GET | `/healthz` | — | `{status}` | liveness |
| POST | `/chat` | `{message, session?}` | `ChatResponse` | single call; **no `facts`** |
| POST | `/investigate` | `{message, session?}` | `ChatResponse` + `facts[]` | two-call pipeline; **use this for links** |
| POST | `/plan` | `{message}`, `?kind=qwen\|laya` | `{planner, plan_ms, tools[]}` | debug; no tools |
| POST | `/speak` | `{message, voice?}` | `audio/wav` | Kokoro TTS |
| POST | `/voice/transcribe` | multipart `file` | `{text}` | 501 unless `STT_URL` set |
| GET | `/actions` | — | `{enabled, catalog, pending}` | level-2 action catalog |
| POST | `/actions/request` | `{tool, args}` | token info | mints a confirmation token |
| POST | `/actions/confirm` | `{token}` | result | executes after human confirm |
| GET | `/audio/{id}` | — | `audio/wav` | `202` while synthesizing, `404` unknown |
| GET | `/metrics` | — | Prometheus text | LLM per-stage instrumentation |
| GET | `/` | — | HTML | the whole UI |
| POST | `/ui/message` | form `message, mode(chat\|investigate), session` | HTML fragment | htmx target |

`ChatResponse`: `reply, tool, metrics, screen_md, speech, facts, audio_id`.

Concurrency: `/chat`, `/investigate`, `/plan` pass through a bounded in-process
LLM limiter → `429` + `Retry-After` when full. `/investigate` can take up to
~150 s (plan → parallel fan-out → correlate).

## Evidence / deep-link contract

`provenance.enrich()` (never sent to the LLM) decorates each fact:

```json
{ "tool": "query_prometheus", "args": {"query": "sum(rate(hubble_drop_total[5m]))"},
  "ok": true, "ms": 79.9, "at": "2026-10-08T19:58:15+00:00", "source": "victoriametrics",
  "reproduce": {"promql": "sum(rate(hubble_drop_total[5m]))"},
  "links": {"grafana": "http://192.168.0.245/explore?…"} }
```

- `links.grafana` — direct Grafana Explore URL (`query_prometheus`).
- `links.hubble` — namespace-scoped Hubble link (facts carrying a namespace).
- `links.neo4j` — only for `get_topology_snapshot`.
- `reproduce.cli` / `reproduce.promql` — copyable command.

Both `links.*` and `reproduce.*` are the exact units fuwa should turn into
buttons. In the assistant they are emitted by `ui.py` as `target="_blank"`
anchors (three places: the fragment's fact rows, the `UI_LINKS` header bar, and
Markdown link rendering) — that is the new-tab behaviour to replace.

## Blocker — CORS / transport

**Resolved** — the assistant now returns `Access-Control-Allow-Origin: *` (owner
updated it; the wildcard is intentional for now). fuwa (`192.168.0.244`) can
`fetch()` it (`192.168.0.243`) directly. The two options that would have
resolved it:

1. add `CORSMiddleware` to `server.py` (allow the fuwa origin), or
2. put the assistant behind a **same-origin fuwa nginx proxy**.

## Options

| # | Approach | Controls deep links? | Cost |
|---|---|---|---|
| 1 | **Native fuwa chat** (`.fuwa` + petite-vue) calling `/investigate` | **Yes** | reimplement chat UX (pending bubble, TTS via `/audio/{id}`, metrics, copy) |
| 2 | Fetch `/ui/message` fragments, own the DOM, intercept `<a>` clicks | **Yes** | least rendering work; also removes the iframe scrollbar |
| 3 | Keep the cross-origin iframe | No | none — cannot inject handlers |

Option 1 is the chosen direction (full control of markup, scrollbars, links).

## Option 1 — ASCII

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ide-header   [architecture ↗] [Deploy]     [Assistant ⌘] [Grafana ↗] [Cilium ↗]│
├──────────────────────────────────────────────┬─────────────────────────────┤
│  ide-panel (code)                            │ ◈ ASSISTANT            ✕    │
│                                              │ ┌─────────────────────────┐ │
│                                              │ │ you: why are drops up?  │ │
│                                              │ └─────────────────────────┘ │
│                                              │ ┌─────────────────────────┐ │
│                                              │ │ bot: 3 dropped flows …  │ │
│                                              │ │  • query_prometheus     │ │
│                                              │ │    sum(rate(hubble_…))  │ │
│                                              │ │    [Grafana] [Hubble]   │ │ ← openPanel(url), NO new tab
│                                              │ │    copy  promql         │ │
│                                              │ └─────────────────────────┘ │
│             preview island                   │ ┌─────────────────────────┐ │
│                                              │ │ type a message…     ➤   │ │
│                                              │ └─────────────────────────┘ │
└──────────────────────────────────────────────┴─────────────────────────────┘
```

Click flow (the whole point):

```
   assistant HTML                 fuwa-native chat
   <a target="_blank">    ──►     button @click="openPanel('…')"
        │                                    │
        ▼                                    ▼
   NEW TAB (today)                fuwa dash-panel (Grafana/Hubble/Neo4j embed OK)
```

## How it would be implemented (sketch)

| Piece | Where |
|---|---|
| Chat drawer + markup | `shell/views/fragments/home.fuwa` `.assistant-drawer` |
| Chat state + submit + deep links | `shell/hooks/workspace.js` (`sendAssistant`, `openAssistantLink`) |
| POST `/investigate` | `workspace.js` `sendAssistant` (same origin not needed — CORS) |
| Deep links → panel | `openAssistantLink(url)` → `openPanel(url)` |
| TTS | not wired (v1) |

> **Load-order note (a real trap):** `workspace.js` mounts petite-vue as soon as
> it runs. Any `v-scope` expression resolves at mount, so it must reference only
> globals defined **in or before** `workspace.js`. Referencing a global from a
> later-loaded hook throws and fails the whole mount silently. This is why the
> chat state lives in `workspace.js` and not a separate hook.

## How to verify

1. `POST /investigate` from the shell origin returns `facts[]` with `links`.
2. Clicking a fact's **Grafana** link opens the fuwa panel, **not** a new tab.
3. Same for `hubble` / `neo4j`.
4. No cross-origin errors in the console (CORS/proxy in place).

## Limits / open questions

- `/investigate` is the slow path (~150 s) — the native UI must show a pending
  state and honour the `429 + Retry-After` backpressure.
- Session continuity uses `session` ids; fuwa must keep one per drawer.
- Voice (`/speak`, `/voice/transcribe`) is a bolt-on; not required for v1.
- Whether to add CORS to the assistant or proxy it through fuwa is **undecided**
  (proxy keeps the assistant unchanged; CORS keeps fuwa's nginx clean).
