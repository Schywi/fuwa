# fuwa AI Plugin — Design

## Philosophy

The AI plugin is a **client-side add-on**, not a core feature. It lives in
`/plugins/ai/` and follows the same isolated pattern as observability
(`shell/hooks/observability.js`): an IIFE that registers itself on a
`window.FuwaShellAI` global and mounts into a workspace tab via
`[data-ai-root]`.

**Zero server, zero compiler changes, zero Lua changes.** The plugin calls
the DeepSeek API directly from the browser using the user's own API key
(stored in `localStorage`). This is the same model Cursor, Windsurf, and
Copilot use — the key belongs to the developer, not the application.

## Architecture

```
Browser (chat.js)                                    DeepSeek API
     │                                                    │
     │── POST https://api.deepseek.com/chat/completions ──►
     │    Authorization: Bearer $KEY (from localStorage)   │
     │    { model, messages, stream: true }                │
     │                                                    │
     │◄── SSE: data: {"choices":[{"delta":{"content":...   │
```

## What the AI can access

| Resource | How | Trust |
|---|---|---|
| Payload source code | Reads `pending_edits` Map from `editor.js` (exposed via `window.__fuwa_editor_sources`) | Read-only |
| Compile diagnostics | Worker `stderr` captured by runtime-session.js, forwarded to AI context | Read-only |
| Live worker execution | `plugins/ai/worker-bridge.js` adds `ai_exec` message type to the Wasmoon worker protocol. AI can request Lua snippet execution → returns stdout + return value | Sandboxed read-only |
| DB state | Via worker execution — SQL SELECT queries run in the existing SQLite-WASM instance | Read-only |
| Conversation history | In-memory JS array in chat.js. Cleared on page close. | Ephemeral |

The AI **cannot** modify files. It can only suggest changes. The user
decides to apply them. This is the same safety model Cursor uses.

## File structure

```
plugins/ai/
├── chat.js            # Chat UI, conversation state, DeepSeek API calls
├── worker-bridge.js    # Extends runtime-worker.js with ai_exec message
└── README.md           # This file (symlink or copy of docs/ai/design.md)

docs/ai/
└── design.md           # Architecture documentation (this file)
```

## API key management

- On first use: prompt for API key, store in `localStorage.fuwa_ai_deepseek_key`
- Key is only sent to `api.deepseek.com` — never to any other origin
- Clear key: type `/clear-key` in the chat input
- Key is scoped to the browser, not the payload

## View lifecycle

The AI panel follows the same lifecycle as `[data-obs-root]`:

1. `workspace.js` calls `window.FuwaShellAI.mount(root)` when the ai tab
   is selected
2. `chat.js` creates petite-vue state, mounts into `[data-ai-root]`
3. `window.FuwaShellAI.refresh(scope)` re-mounts on HTMX swaps
4. `window.FuwaShellAI.unmount(root)` cleans up on tab switch

## Worker bridge protocol

Extends `runtime-worker.js` message handler:

```
Host → Worker:  { type: "ai_exec", code: "return 1+1" }
Worker → Host:  { type: "ai_done", stdout: ["2"], result: 2 }
                { type: "ai_error", error: "syntax error at line 1" }
```

The Lua snippet runs in the same Wasmoon instance with full access to:
- VFS (via `__fuwa_vfs_read`)
- SQLite DB (via `__fuwa_db_op`)
- All loaded modules (via `package.loaded`)

This is what gives the AI its execution capability — it can query state,
inspect modules, and verify its own suggestions.

## Future: payload-level AI (Lua stdlib)

If payloads need AI access, add `plugins/runtime/stdlib/ai.lua`:

```lua
local M = {}
function M.ask(prompt, opts)
  -- Posts ai_request to host via postMessage bridge
  -- Host calls DeepSeek API, returns response
end
return M
```

This is deferred — not needed for the initial IDE assistant.
