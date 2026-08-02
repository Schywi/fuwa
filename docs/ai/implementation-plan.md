# Implementation Plan: Browser-Native AI Runtime

Location: everything in this plan is implemented in **this repo**
(`/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ai-integration`).

This document replaces the current provider-shaped AI plugin direction with a
browser-native AI runtime built for the actual Fuwa architecture: OpenResty as
the edge shell, Wasmoon as the Lua runtime, SQLite-WASM as local persistence,
and the shell as a thin orchestration layer.

The immediate goal is not "ship a chatbot." The immediate goal is to make AI
useful inside the IDE without adding a server dependency, without unbounded
memory growth, and without turning the shell into a provider-specific prompt
wrapper.

## What We Have Right Now

The current integration branch already contains a transplanted AI surface from
the exploratory branch:

- `plugins/ai/chat.js`
- `plugins/ai/worker-bridge.js`
- `plugins/ai/tools/*.js`
- shell integration in `shell/views/layout.fuwa` and
  `shell/views/fragments/workspace.fuwa`

That implementation is useful as a UI seed, but architecturally it is still the
wrong shape for production:

- the primary UX is a chat panel
- the client owns a rolling message array
- the provider request format leaks into the UI layer
- model access is assumed to be remote
- context assembly is based on "whatever files are currently open"
- runtime inspection is mixed together with provider prompting

The branch also already has the production runtime boundaries we must preserve:

- OpenResty shell routes and static asset serving
- browser runtime worker under `shell/hooks/runtime-worker.js`
- runtime session orchestration under `shell/hooks/runtime-session.js`
- local SQLite state already available in the worker
- trace and terminal hooks already exposed to the shell

That means the right next step is not a rewrite from scratch. It is a staged
refactor from "provider-backed AI chat" to "local task runtime with bounded
tools."

## The Four Architectural Decisions

This plan assumes four non-negotiable decisions.

### 1. AI is a task runtime, not a chatbot

The primary contract must be bounded tool calls:

- search source/history
- explain selection
- summarize error or trace
- inspect runtime state
- optional OCR / ASR later

The shell can still render these inside one AI panel, but the internal contract
must be `task -> context -> tool result`, not `chat history -> bigger prompt`.

### 2. Retrieval memory replaces chronological chat memory

We do not carry full conversation history forward forever.

Instead:

1. persist prior AI turns in local SQLite
2. embed them once
3. retrieve only relevant prior turns for the next task
4. assemble a small prompt
5. discard live generation context after the answer completes

This keeps memory bounded and avoids KV-cache growth as sessions get longer.

### 3. OpenResty is a distribution/control plane, not the inference engine

OpenResty should:

- serve model manifests and artifacts
- expose versioned asset URLs
- apply cache headers and ETags
- surface capability/config manifests
- optionally gate future provider fallback

OpenResty should not:

- own AI session memory
- be required for normal inference after model download
- sit in the hot path for every AI request

### 4. Deterministic tools beat weak models whenever possible

The branch already has real runtime information available through Wasmoon and
the browser worker. We should prefer:

- parser-based source inspection
- Wasmoon trace hooks
- SQL queries against local SQLite
- explicit runtime snapshots
- rules-based error classification

over small-model guesswork whenever the answer can be computed directly.

## Target Product Shape

The target v1 product is a browser-native AI assistant with five bounded
capabilities:

1. `search`
   Semantic search across AI notes, prior turns, selected sources, and indexed
   snippets.
2. `explain`
   Short explanation of the current selection, current error, or current trace.
3. `trace`
   Deterministic runtime inspection backed by Wasmoon hooks, with optional small
   summaries layered on top.
4. `summarize`
   Summaries of diagnostics, logs, SQL output, or backtraces.
5. `memory`
   Retrieval of relevant prior turns and saved notes from local SQLite.

Everything else is phase 2:

- OCR
- voice commands
- image understanding
- larger desktop-only local models

This keeps the first production architecture aligned with actual IDE needs.

## Model Strategy

The local model strategy should follow the measured Pareto picks rather than
"one general model for everything."

### v1 models we should support

- `Model2Vec (potion-base-8M)` for embeddings and retrieval
- `Gemma 3 270M` **or** `SmolLM2-135M-Instruct` for short explanations
- no classifier model in v1
- no code-tagging model in v1

### v1 deterministic replacements

- code/token inspection: parser or source scanner
- error classification: rules-based Lua/runtime matcher
- trace explanation: Wasmoon trace + small summarizer

### models we should defer

- `Qwen2.5-0.5B` and larger
- `SmolVLM-256M`
- object detection
- image classification
- speech and OCR until the core architecture is stable

The main reason is not theoretical quality. It is memory margin and operational
focus. The first production version should prove stability, not model breadth.

## Runtime Topology

The current plugin mixes UI, provider logic, and runtime access too tightly.
The replacement should split into two workers plus a thin shell coordinator.

### Worker A: `ai-runtime-worker`

Responsibilities:

- ONNX/Transformers.js runtime initialization
- embeddings
- retrieval search
- optional summarization
- OPFS model cache management
- model LRU eviction
- capability detection and backend selection
- indexing job execution

This worker should be optimized for persistence and reuse. It is the long-lived
AI state holder.

### Worker B: `ai-gen-worker`

Responsibilities:

- bounded local generation
- one-shot explanation and summarization requests
- strict token cap enforcement
- prompt assembly from already-curated context
- generation metrics

This worker should remain deliberately narrow. It should not become a general
chat session manager.

### Main thread / shell responsibilities

- mount and unmount the AI panel
- collect user intent
- collect current selection / current file / current trace id
- request context fragments from the runtime worker
- dispatch tasks to the correct worker
- render concise results

The shell should not hold large AI state beyond UI state.

## Proposed File Layout

The current `plugins/ai` tree should be refactored into explicit ownership
modules instead of one provider-shaped chat script.

### Shell-facing modules

```text
plugins/ai/
  panel.js
  commands.js
  state.js
  format.js
```

- `panel.js` mounts the AI pane and binds events
- `commands.js` maps slash commands and user actions to task requests
- `state.js` owns minimal UI state only
- `format.js` renders task results and small logs

### Core orchestration modules

```text
plugins/ai/core/
  task-router.js
  context-assembler.js
  memory-store.js
  backend-select.js
  model-manager.js
  metrics.js
```

- `task-router.js` maps task type to worker call
- `context-assembler.js` builds bounded task input
- `memory-store.js` wraps SQLite-backed AI memory
- `backend-select.js` chooses WebGPU vs WASM and capability tier
- `model-manager.js` handles manifest loading, cache, warm models, eviction
- `metrics.js` emits small structured logs only

### Worker entrypoints

```text
plugins/ai/workers/
  ai-runtime-worker.js
  ai-gen-worker.js
```

### Tool adapters

```text
plugins/ai/tools/
  search.js
  explain.js
  trace.js
  summarize.js
  runtime.js
  sources.js
```

These are not provider tools. They are internal task adapters with explicit
contracts.

### OpenResty support files

```text
runtime/openresty/ai/
  manifest.lua
  models.lua
  cache_headers.lua
```

These files should own manifest serving and cache policy. They must not contain
inference logic.

## Context Assembly Policy

This is the most important behavioral change.

The current plugin builds prompt context from whatever is open in the editor and
whatever chat history is still in memory. That is easy to prototype and wrong
for production.

The new context policy should be deterministic.

### For `explain selection`

Include only:

- selected text
- current file path
- nearest enclosing source block if available
- top-k relevant prior AI memory entries
- optional current diagnostics or trace summary

Do not include:

- the entire repo
- every edited file
- chronological chat history

### For `summarize error`

Include only:

- current error / diagnostics text
- current route or file if known
- optional relevant trace frames
- top-k prior matching error summaries

### For `search`

Do not prompt a local LLM first.

Instead:

1. embed the query
2. retrieve top-k records
3. show ranked results
4. optionally let the user request explanation of one result

### For `trace`

Prefer deterministic runtime queries first:

- trace events
- terminal lines
- selected SQL rows
- loaded module names
- VFS file list

Only invoke a small generative model after the trace snapshot is already built.

## Retrieval Memory Design

The repo already uses browser-local persistence in the runtime. AI memory should
use the same local-first principle.

### Storage location

Use the existing SQLite-WASM environment for metadata and records.

Vectors should be stored in a form that keeps the implementation simple first:

- either compact float arrays serialized to blobs
- or external vector files keyed by SQLite rows if SQLite blob handling becomes
  awkward in the first pass

Do not introduce an external vector database.

### Initial schema

```sql
create table if not exists ai_memory_entries (
  id text primary key,
  kind text not null,
  scope text not null,
  source_path text,
  source_hash text,
  selection_start integer,
  selection_end integer,
  title text,
  body text not null,
  created_at integer not null,
  last_used_at integer not null,
  use_count integer not null default 0
);

create table if not exists ai_memory_vectors (
  entry_id text primary key references ai_memory_entries(id) on delete cascade,
  dim integer not null,
  vector_blob blob not null
);

create table if not exists ai_task_runs (
  id text primary key,
  task_kind text not null,
  backend text not null,
  model_id text,
  started_at integer not null,
  duration_ms integer,
  status text not null,
  tokens_in integer,
  tokens_out integer,
  error_text text
);
```

This is enough for v1. Do not design a large generalized knowledge graph.

### Entry types

`ai_memory_entries.kind` should initially support only:

- `turn`
- `note`
- `summary`
- `trace`
- `diagnostic`

Keep this tight until retrieval quality is proven.

## Model Manifest and Cache Policy

The browser runtime needs a single source of truth for model identity, loading,
and capability gating.

### Manifest shape

Serve one manifest describing:

- model id
- task types supported
- artifact URLs
- runtime family
- preferred backend
- warm/cold priority
- memory estimate
- platform exclusions

For example:

```json
{
  "version": 1,
  "models": [
    {
      "id": "model2vec-potion-base-8m",
      "tasks": ["embed", "search"],
      "runtime": "onnx",
      "preferred_backend": "wasm",
      "warm_priority": 1,
      "estimated_mb": 35
    },
    {
      "id": "smollm2-135m-instruct-q4",
      "tasks": ["explain", "summarize"],
      "runtime": "gen",
      "preferred_backend": "webgpu",
      "fallback_backend": "wasm",
      "warm_priority": 2,
      "estimated_mb": 190,
      "max_context_tokens": 512
    }
  ]
}
```

### Cache policy

Use OPFS for model artifacts and metadata:

- persist artifact files by content hash
- persist manifest version
- persist ETag or content digest
- verify cache validity on startup

OpenResty should serve immutable hashed URLs whenever possible.

### LRU policy

This is mandatory because the user can trigger multiple tasks in one session.

The model manager must:

1. track warm models and estimated resident memory
2. evict least-recently-used models before loading a new one near budget
3. keep at most:
   - one generation model warm
   - one retrieval model warm
   - zero optional media models warm by default

This keeps the resident set bounded even when users switch between tasks.

## Capability Tiers

The runtime must not assume one device class.

### Tier 1: iOS Safari / constrained mobile

- force WASM path
- disable heavy optional models
- use smallest explanation model only
- disable VLM entirely

### Tier 2: desktop / Android with working WebGPU

- WebGPU allowed
- keep small generation model + embeddings model warm
- optional future larger model behind explicit opt-in only

### Tier 3: no WebGPU or blacklisted adapter

- retrieval and deterministic tools still work
- explanation either uses CPU-safe small model or is disabled with a clear
  diagnostic

This capability decision should be computed once and cached as shell state.

## Migration Plan

The current branch already exposes a visible AI surface. We should migrate it in
phases rather than replacing everything in one diff.

## Phase 1: Detach the UI from DeepSeek/OpenAI assumptions

### Goal

Keep the panel, remove provider ownership from the architecture.

### Work

- replace `chat.js` monolith with panel/core split
- rename task surface away from provider prompt language
- remove provider-specific labels from the main UI
- keep `/key` and provider fallback only as an explicit compatibility layer
- preserve the current read-only apply/suggest safety model

### Acceptance criteria

- AI panel still mounts in the workspace
- no core module depends directly on a provider request format
- current runtime inspection tools still function

## Phase 2: Add local retrieval memory

### Goal

Make memory local, bounded, and queryable without chat accumulation.

### Work

- add SQLite schema
- add `memory-store.js`
- add Model2Vec runtime path
- persist task results and notes
- retrieve relevant prior turns for `explain` and `summarize`

### Acceptance criteria

- repeated sessions can retrieve prior notes after reload
- prompt size stays bounded across many turns
- semantic search works without any provider call

## Phase 3: Add local explanation runtime

### Goal

Replace remote-first explanation with local bounded generation.

### Work

- add generation worker
- enforce `max_context_tokens = 512`
- implement one-shot explanation contract
- instrument duration and token counts
- provide clear capability fallback for unsupported devices

### Acceptance criteria

- selected code can be explained without network access after model warmup
- no rolling chat history is required
- generation task logs stay small and structured

## Phase 4: Rebuild task routing around bounded tools

### Goal

Make every AI action explicit and testable.

### Work

- `search`
- `explain`
- `trace`
- `summarize`
- `runtime`

Each one must have:

- typed request input
- bounded context builder
- explicit result shape
- deterministic fallback behavior

### Acceptance criteria

- each task can be invoked independently
- no generic "send everything to the model" path remains
- trace and runtime tasks work without invoking a local LLM unless requested

## Phase 5: Optional media tools

### Goal

Layer OCR and ASR only after the text/runtime architecture is stable.

### Work

- add OCR recognizer path
- add speech transcription path
- add transferable buffer plumbing
- add per-task model cold-loading and eviction

### Acceptance criteria

- media tasks do not regress text tasks
- optional models are not loaded at boot

## OpenResty Work

OpenResty changes must stay narrow and infrastructure-shaped.

### Required server responsibilities

- serve `/plugins/ai/*`
- serve `/ai/manifest.json`
- serve versioned model artifacts
- support cache headers and ETag validation
- expose a capability/config endpoint if needed

### Optional later responsibilities

- signed remote-provider fallback
- remote artifact mirrors
- usage telemetry ingestion

### Explicit non-goals

- server-side prompt assembly
- server-side conversation memory
- server-side mandatory inference for normal operation

## Observability and Logging

Logs must stay tiny and specific.

### Production log set

- `ai.backend.selected`
- `ai.model.cache.hit`
- `ai.model.cache.miss`
- `ai.model.load.start`
- `ai.model.load.done`
- `ai.model.load.fail`
- `ai.model.evict`
- `ai.task.start`
- `ai.task.done`
- `ai.task.fail`
- `ai.task.kind`
- `ai.task.ms`
- `ai.task.tokens_in`
- `ai.task.tokens_out`
- `ai.memory.bucket`

### Rules

- never log full prompts by default
- never stream token-by-token logs by default
- never log raw source payloads in production metrics
- allow a debug mode for local diagnostics only

## Testing Plan

The implementation is only useful if the boundaries are testable.

### Unit tests

- backend selection logic
- context assembler bounds
- retrieval ranking and pruning
- model manager LRU decisions
- prompt/token cap enforcement
- rules-based error classifier

### Browser/runtime tests

- AI panel mount/unmount across workspace view switches
- manifest fetch and cache behavior
- worker task request/response contracts
- local retrieval memory surviving reload
- fallback path when WebGPU is unavailable

### Integration tests

- explain current selection offline after warm cache
- search prior AI memory entries offline
- trace summary from live runtime state
- OpenResty serves manifest and model assets with correct headers

### Non-goals for v1 tests

- broad benchmark automation for every model
- image/voice regression suites before those tasks exist

## Migration Risks

The risky parts are clear and should be called out early.

### Risk 1: the UI keeps provider-shaped assumptions

Mitigation:

- move provider code behind an explicit compatibility adapter
- keep internal task contracts provider-agnostic

### Risk 2: local generation quality disappoints

Mitigation:

- keep task scope narrow
- prefer explanation and summarization over open-ended conversation
- let deterministic tools carry more of the answer

### Risk 3: multiple models exceed memory together

Mitigation:

- strict LRU eviction
- capability tiers
- one warm generation model, one warm retrieval model maximum

### Risk 4: retrieval memory becomes noisy

Mitigation:

- keep entry types tight
- cap retrieval to small top-k
- prefer short summaries over raw long turns

### Risk 5: branch-specific runtime wiring regresses shell stability

Mitigation:

- land migration in phases
- preserve current AI panel mount points
- verify view-switch and worker contracts after each phase

## Recommended Rollout Order

This is the order that minimizes risk while still moving the architecture
forward.

1. document the target architecture
2. split panel UI from provider logic
3. add manifest + model manager + capability detection
4. add local retrieval memory
5. add local explanation worker
6. convert task routing to bounded tools
7. remove provider-first behavior from the default path
8. add optional OCR / ASR only after the text path is stable

## Definition of Done

This AI architecture is "real" only when all of the following are true:

- the default path works without a provider API key
- memory growth is bounded by retrieval + token caps + LRU eviction
- OpenResty only serves assets/manifests and does not own the normal inference
  path
- source inspection, trace inspection, and DB inspection use deterministic tools
  first
- the AI panel exposes bounded tasks rather than an unstructured long-lived
  chat
- the shell remains stable across view switches and payload reloads

Until those are true, the current AI panel should be treated as a transitional
surface, not the final architecture.
