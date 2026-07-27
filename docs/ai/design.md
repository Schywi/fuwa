# fuwa AI Plugin — Design v2

## Philosophy

The AI plugin is a **read-only runtime analyst**. It classifies user questions,
fetches only the minimum relevant data from categorized tools, and uses a
two-pass planner/analyst loop with the DeepSeek API. It cannot modify code.

**Zero server proxy.** The API key lives in `.env` (gitignored), read by the
Python dev server at startup, served to the browser via `/__dev/config`. No
key ever touches localStorage.

## Architecture

```
User question
     │
     ▼
classifier.js ──► local rules engine, zero-latency
     │              maps keywords → intent + tool set
     ▼
orchestrator.js ──► two-pass loop (max 3 rounds)
     │
     ├── auto-fetch cheap tools (traces, active file)
     ├── call planner (DeepSeek) → JSON: needs_more? which tools?
     ├── fetch requested tools (sync + async)
     ├── call analyst (DeepSeek) → JSON: answer + evidence + confidence
     │
     ▼
chat.js ──► renders answer with metadata (intent, fact count, rounds, elapsed)
```

## Tool taxonomy

| Tool | Cost | Auto? | Returns |
|---|---|---|---|
| `traces` | ~40 tokens/trace | Yes (5 traces) | `{method, path, status, duration_ms, stages}` |
| `terminal` | ~200-400 tokens | No | Error blocks only by default |
| `source_excerpt` | ~300-1000 tokens | No | File slice by path + line range |
| `active_file` | ~20 tokens | No | Current open file path + line count |
| `db_schema` | ~100 tokens | No | Table names + row counts |
| `db_sample` | ~300 tokens | No | First N rows from a table |
| `modules_list` | ~200 tokens | No | Loaded Lua module names |
| `vfs_list` | ~200 tokens | No | Files in the worker VFS |

## Intent classification

| Intent | Triggers | Auto-tools |
|---|---|---|
| `debug_failure` | "error", "crash", "500", "broken" | traces, terminal |
| `explain_code` | "explain", "what does", named file | active_file |
| `inspect_database` | "database", "schema", "rows" | db_schema |
| `perf_analysis` | "slow", "latency", "timing" | traces |
| `inspect_runtime` | "modules", "loaded", "vfs" | modules_list |
| `analyze_traces` | "trace", "request", "route" | traces |
| `general` | (fallback) | traces, active_file |

## Planner prompt

Short, returns JSON only. Decides if more data is needed and which tools to call.
Uses `deepseek-v4-flash` with `response_format: { type: "json_object" }`.

## Analyst prompt

Takes gathered facts, returns JSON with answer, evidence, root cause, confidence.
Same model, different system prompt.

## File structure

```
plugins/ai/
├── chat.js                # Thin UI shell
├── worker-bridge.js        # Wasmoon execution bridge
└── tools/
    ├── index.js            # Registry + context assembly
    ├── classifier.js       # Local intent classification (NEW)
    ├── orchestrator.js     # Planner/analyst loop (NEW)
    ├── traces.js           # Summarized request traces
    ├── terminal.js         # Error-block extraction
    ├── sources.js          # File excerpts (on-demand only)
    └── runtime.js          # DB schema, samples, modules, VFS
```

## Key model

The DeepSeek API is called from the browser. The API key comes from the
dev server via `GET /__dev/config`. No key ever stored in localStorage.

Model: `deepseek-v4-flash` for both planner and analyst passes.
Endpoint: `POST https://api.deepseek.com/chat/completions`
