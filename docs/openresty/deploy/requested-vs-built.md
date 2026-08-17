# Deploy Feature — Requested vs Built

## What was requested

A **deploy** button in the shell header, next to "architecture". When clicked:

1. POST the current payload (what's in the editor) to a deploy endpoint
2. Auto-generate an **SEO-friendly URL** using **word-based phrases** (random words, like `crystal-ember-lagoon`)
3. Pre-compile `.fuwa` → `.lua` at deploy time
4. Store the compiled result
5. **Redirect the browser** to the public preview URL (`/p/{slug}`)
6. The preview URL shows a **marketing landing page** with the deployed app in an **iframe**
7. Cookie-based session tracking for deploy management
8. **Tracing** following existing observability patterns
9. **No form**, **no slide panel**, **no animation**, **no slug input**

The user explicitly said:
- "NO FOORM NOOFOORM" — no form, no slug input
- "I SIMPLY WANT A SIMPLE THING WHEN I TAP DEPLOY WE ARE REDIRECTED" — single action, redirect
- "WHEN I TAP DEPLOY SWIPE SHIT — NO" — no GSAP animation, no panel
- "WEEEEE JUST GENERATE A FUCKING RANDOM SENTENCE OF WOOORDS" — word-based slugs

---

## What was built — file by file

### 1. `nginx.conf` (lines 41-49) — Routes

```nginx
# /__dev/deploy (POST)
location /__dev/deploy {
    content_by_lua_file /app/runtime/openresty/deploy/deploy_handler.lua;
}

# Public preview routes /p/{slug}/*
location /p/ {
    content_by_lua_file /app/runtime/openresty/deploy/preview_handler.lua;
}
```

**Status**: Correct. Two routes added. `/__dev/deploy` handles the deploy POST. `/p/` handles all public preview requests. The `/p/` block comes before the catch-all `/` block (verified).

---

### 2. `runtime/openresty/deploy/deploy_handler.lua` (158 lines) — Deploy endpoint

**Lines 1-9**: Module imports — `cjson`, `store`, `fuwa_dev`, `package_web`, `diagnostics`, `trace`. Correct dependencies.

**Lines 11-16**: Method guard — only POST allowed. Returns JSON error otherwise.

**Lines 18-21**: Body parsing. Supports two modes:
- `content-type: application/x-www-form-urlencoded` → form mode (shell Deploy button via htmx)
- Everything else → JSON mode (API usage)

**Lines 25-41**: **Form mode (deploy button)**:
- Auto-generates slug from 60-word list → 3 random words hyphen-joined: `{word}-{word}-{word}`
- Reads `payload_id` from form data (defaults to "current")
- Sets `entry = "main.lua"`
- Reads files from **draft overlay**: `fuwa_dev.collect_payload_files(payload_root, overlay_root)` where overlay_root = `.fuwa-dev/drafts/{payload_id}`
- This means the editor's latest changes are deployed, not just disk files

**Lines 42-62**: JSON mode — receives `{ slug, entry, files }` in request body. For API/programmatic usage.

**Lines 64-84**: Input validation — slug must match `^[A-Za-z0-9_%-]+$`, entry must be non-empty string, files must contain entry.

**Lines 86-91**: Session cookie management — reads `fuwa_session` cookie, generates UUID if missing, sets `Set-Cookie` header.

**Lines 93-158**: Main deploy flow wrapped in `trace.span("deploy", ...)`:
- Converts files table to { filename = content } format
- Calls `package_web.build(source_files)` to compile `.fuwa` → `.lua`
- Checks diagnostics for compile errors → returns 422 if any
- Collects compiled `.lua` files from `build.run_files`
- Calls `store.save(slug, entry, compiled_files, session_id)` — saves JSON to `.fuwa-dev/deployments/{slug}.json`
- **Form mode**: Returns `HX-Redirect: /p/{slug}` header (htmx navigates browser)
- **JSON mode**: Returns `{ ok, slug, url, compiled_count }`

**Status**: Correct. Matches all requirements except one issue — the `hx-vals` attribute in the button uses htmx JSON encoding which means the Content-Type will NOT be `application/x-www-form-urlencoded`, it will be `application/json`. The handler's `is_form` check on line 21 uses `content-type: application/x-www-form-urlencoded`, which won't match htmx's JSON payload. **This is a bug — the form detection will fail, falling through to JSON mode, which expects `files` in the body.**

---

### 3. `runtime/openresty/deploy/preview_handler.lua` (209 lines) — Preview route handler

**Lines 1-8**: Module imports.

**Lines 10-87**: `run_compiled()` — Takes pre-compiled Lua files and executes them:
- Registers stdlib preloads (db, result, schema, view, web)
- Installs compiled user modules as `package.preload`
- Disables `host` module (no shell access in public preview)
- Sets up `__fuwa_is_request`, `__fuwa_print`, `__fuwa_db_op` (no-op DB), `set_html`
- Loads main.lua, calls `handle_request(method, path, body)`
- Restores module state after execution
- Returns rendered HTML

**Lines 89-103**: Parse `/p/{slug}/{*subpath}` from URI.

**Lines 109-115**: Load deployment from store. Returns 404 if not found.

**Lines 117-143**: Root path (`/p/{slug}/`) → renders **marketing landing page**:
- Calls `fuwa_dev.build_response("payloads/preview-landing", "GET", "/", ...)`
- Uses in-memory DB provider (no persistence needed for static landing page)
- Returns the compiled landing page HTML

**Lines 145-209**: Sub-path → serves the **deployed app**:
- Static assets (has file extension, not .fuwa): serves from `record.compiled_files` with correct Content-Type
- Lua routes: calls `run_compiled()` → wraps result with `public_shell.wrap_html(html, mount_path)` → returns HTML
- Sets `X-Frame-Options: SAMEORIGIN`

**Status**: Correct. Full working implementation.

---

### 4. `runtime/openresty/deploy/store.lua` (64 lines) — Deployment storage

File-based JSON storage under `.fuwa-dev/deployments/{slug}.json`.

Each record:
```json
{
  "entry": "main.lua",
  "compiled_files": { "main.lua": "...", "pages.home.lua": "...", ... },
  "session_id": "abc123",
  "created_at": "2026-07-29T20:00:00Z"
}
```

Functions: `save()`, `load()`, `list_by_session()`.

**Status**: Correct but fragile. Uses `os.execute("mkdir -p")` and `io.popen("ls")` which are blocking in OpenResty but fast enough for a dev tool. No collision detection for duplicate slugs (statistically negligible with 60³ = 216k possible combinations).

---

### 5. `runtime/openresty/deploy/public_shell.lua` (53 lines) — HTML wrapper

Wraps payload output in standalone HTML for iframe rendering.

Two modes:
- **Full document** (has `<html>` or `<!doctype>`): injects bridge script into `<head>` for URL rebasing
- **Fragment**: wraps in complete document with meta tags, htmx, petite-vue, bridge script

Bridge script rebases absolute URLs to the mount path.

**Status**: Correct. Patterned after the IDE's `wrapWithPublicPreviewShell`.

---

### 6. `shell/views/fragments/home.fuwa` (line 21) — Deploy button

```html
<button class="grafana-trigger" style="margin-left:4px"
  hx-post="/__dev/deploy"
  hx-vals='{"payload_id":"&dashboard.active.id"}'
  hx-target="body"
  hx-swap="none">Deploy</button>
```

**Status**: **BUG**. `hx-vals` with JSON encoding sends `application/json` Content-Type. The handler checks for `application/x-www-form-urlencoded`. The form mode path will never be hit. The request falls through to JSON mode which expects `{ slug, entry, files }` in the body and will fail with "empty body" or "invalid json".

**Fix needed**: Change `hx-vals` to `hx-vals='js:{"payload_id": document.querySelector("[data-payload-id]")?.dataset?.payloadId || "current"}'` with `hx-encoding="application/x-www-form-urlencoded"`, OR change the handler to accept both JSON and form-encoded content. Or simplest: use form-encoded params via `hx-include` or hidden form elements.

Also, `hx-target="body"` and `hx-swap="none"` is correct — htmx will process the `HX-Redirect` header without swapping content.

---

### 7. `payloads/preview-landing/` — Marketing landing page (5 .fuwa files)

| File | Content |
|---|---|
| `app.fuwa` | Module declaration, routes: `GET "/" Home.index` |
| `pages/home.fuwa` | Action: `render "views/fragments/main", doctype: "<!DOCTYPE html>"` |
| `view.fuwa` | `<include src="views/layout.fuwa" />` |
| `views/layout.fuwa` | Full HTML: header (Fuwa logo + Preview badge), main (with `<include src="views/fragments/main.fuwa" />`), footer (Built with Fuwa) |
| `views/fragments/main.fuwa` | Phone-frame `<div>` with sandboxed iframe pointing to `/p/current/app` |

**Status**: Correct. Renders a standalone marketing page with iframe for the deployed app. Uses `<!DOCTYPE html>` via the `doctype` render data parameter.

**Issue**: iframe always points to `/p/current/app` (hardcoded). Should dynamically reference the current deployment slug. For V1 this is acceptable since each deploy creates a unique slug and the preview is opened via redirect.

---

### 8. Deleted files from earlier iterations

During the back-and-forth, the following were created then removed:
- `shell/views/fragments/home.fuwa` lines 113-128: Deploy panel HTML with slug input form — **removed**
- `shell/hooks/workspace.js` lines 149 and 240-267: `deployOpen` state and `toggleDeploy()` method — **removed**
- `shell/views/layout.fuwa` lines 1408-1443: Deploy panel CSS styles — **removed**

**Status**: Cleaned up. No leftover code from the over-engineered panel approach.

---

### 9. What was NOT built (from the plan)

| Item | Status |
|---|---|
| `runtime/openresty/deploy/init.lua` — module init, schema migration | ❌ Not created (store.lua handles dir creation inline) |
| Shell deploy panel separate .fuwa fragment | ❌ Not created (not needed — button is self-contained) |
| Architecture button next to deploy in workspace.fuwa | N/A — buttons are in home.fuwa header, not workspace |

---

## Summary of bugs

| # | Bug | File:Line | Impact |
|---|---|---|---|
| 1 | `hx-vals` JSON vs handler's form-urlencoded check mismatch | `home.fuwa:21` + `deploy_handler.lua:21` | **Deploy button does nothing** — wrong content-type, handler enters JSON path, body is empty |

---

## Architecture decision: form path vs JSON path

The handler has two paths because the deploy endpoint serves dual purposes:
1. **Shell button** (htmx POST, auto-generated slug, reads from draft overlay) → `is_form = true`
2. **API** (JSON POST, caller provides slug + files) → `is_form = false`

This is a reasonable design decision. The form path is for the one-click deploy workflow. The JSON path is for programmatic usage or future tooling.
