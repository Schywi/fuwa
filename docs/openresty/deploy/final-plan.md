# Deploy Button — Final Implementation Plan

## Goal

User clicks "Deploy" in the shell header. The current editor state (draft overlay) is
compiled, stored, and the browser redirects to a public preview URL showing the
deployed app in a marketing landing page.

## What changes

Only 2 files touched. Everything else (store, compile, public_shell, preview_handler,
marketing page `.fuwa` payload) stays exactly as-is.

---

## File 1: `shell/views/fragments/home.fuwa` (line 21)

**Change:** Replace htmx button with a plain `<a>` link.

**Before:**
```html
<button class="grafana-trigger" style="margin-left:4px"
  hx-post="/__dev/deploy"
  hx-vals='{"payload_id":"&dashboard.active.id"}'
  hx-target="body"
  hx-swap="none">Deploy</button>
```

**After:**
```html
<a class="grafana-trigger" href="/__dev/deploy" style="margin-left:4px">Deploy</a>
```

**Why:**
- No htmx → no DOM interference → CodeMirror and xterm survive
- No JavaScript → no page crash on error
- Plain `<a>` link → click → browser navigates → server handles everything
- `grafana-trigger` class already provides button-like styling

---

## File 2: `runtime/openresty/deploy/deploy_handler.lua`

**Change:** Add GET handler for one-click deploy. Keep existing POST handler for API usage.

**New flow:**

```
GET /__dev/deploy:
  1. Pick 3 random words from word list → slug = {word}-{word}-{word}
  2. Read draft overlay: collect_payload_files("payloads/current/", ".fuwa-dev/drafts/current/")
  3. Compile with package_web.build()
  4. Store with store.save(slug, "main.lua", compiled_files, session_id)
  5. Return 302 redirect → /p/{slug}

POST /__dev/deploy (JSON body):
  Unchanged. Receives {slug, entry, files}, compiles, stores, returns JSON {ok, slug, url, compiled_count}.
```

**What to remove from current handler:**
- Method guard — allow both GET and POST
- `is_form` detection — replaced by explicit GET/POST paths
- `HX-Redirect` header — replaced by standard HTTP 302
- `hx-vals` payload handling — no longer needed

**What stays:**
- Word list and `pick()` function
- `collect_payload_files()` with draft overlay
- `package_web.build()` compilation
- `store.save()` storage
- Session cookie management
- `trace.span("deploy", ...)` observability

---

## What the user experiences

```
1. User clicks "Deploy" in shell header
2. Browser navigates to /__dev/deploy
3. Server auto-generates slug: crystal-ember-lagoon
4. Server reads draft overlay (editor state), compiles .fuwa → .lua
5. Server stores compiled result to .fuwa-dev/deployments/crystal-ember-lagoon.json
6. Server returns 302 redirect → /p/crystal-ember-lagoon
7. Browser follows redirect
8. Marketing landing page loads (payloads/preview-landing/)
9. Landing page contains phone-frame iframe pointing to /p/crystal-ember-lagoon/app
10. Iframe loads deployed app (pre-compiled Lua, wrapped in public_shell)
11. User is happy
```

## Files NOT changed

| File | Reason |
|---|---|
| `runtime/openresty/deploy/store.lua` | Already correct — file-based JSON storage |
| `runtime/openresty/deploy/public_shell.lua` | Already correct — wraps HTML for iframe |
| `runtime/openresty/deploy/preview_handler.lua` | Already correct — serves /p/{slug}/ routes |
| `payloads/preview-landing/` (5 .fuwa files) | Already correct — marketing page with iframe |
| `nginx.conf` | Already correct — /__dev/deploy and /p/ routes |
| `shell/hooks/workspace.js` | Already cleaned — no deploy state/animation |
| `shell/views/layout.fuwa` | Already cleaned — no deploy CSS |

## Net result

- 2 files changed (home.fuwa: 1 line, deploy_handler.lua: refactor GET/POST paths)
- Zero new files
- Zero htmx interference
- Zero page damage
- One click → one redirect → happy
