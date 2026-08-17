─────────────────────────────

• Yes. It makes sense to nuke /draft for the live editing path.

  And yes, /IDE already shows the right shape for this.

  What /IDE is doing
  In /IDE, the Lua runtime loop is browser-owned:

  - the worker keeps a VFS in memory at
    /mnt/DATA/development/projects/repos/IDE/src/lib/panels/labs/runtime/lua/
    worker.ts:15
  - every run sends the whole files map into the worker
  - the worker resolves Lua modules from VFS via __fuwa_vfs_read
  - edits update in-memory files, then schedule a rerun:
    /mnt/DATA/development/projects/repos/IDE/src/lib/panels/labs/runtime/
    state.svelte.ts:161
  - there is no draft-overlay round trip in the live runtime loop

  That is the key pattern:

  - edit in browser
  - mutate in-memory file map
  - debounced rerun in worker
  - swap rendered HTML
  - no disk

  fuwa already has most of this:

  - shell/hooks/runtime-session.js:302 already has updateCode(path, contents)
  - shell/hooks/runtime-session.js:255 runs the worker from bundle + in-memory
    sources
  - shell/hooks/preview.js:149 already forwards editor changes into the browser
    runtime
  - shell/hooks/runtime-worker.js:39 already has a VFS

  So the answer is: you do not need a new invention. You need to finish the
  browser-only model and delete the server-draft model from the live loop.

  How to enable live reload without touching disk
  Use this architecture:

  1. Browser boots once from /runtime/<payload>/bundle.json
  2. Bundle includes:
      - compiled files
      - raw sources
      - compiler/runtime VFS files
  3. runtime-session.js stores a canonical in-memory files map
  4. editor.js emits fuwa:editor-change
  5. preview.js forwards to session.updateCode(path, contents)
  6. runtime-session.js debounces and posts:
      - current compiled bundle files
      - current in-memory sources
      - request target
  7. runtime-worker.js recompiles in-worker from in-memory sources
  8. worker returns HTML
  9. tenant iframe swaps HTML
  10. no /draft, no server write, no disk touch

  That is already almost what shell/hooks/runtime-session.js:302 is doing.

  What must be removed
  For live editing, these are the wrong model:

  - runtime/fuwa-dev.lua:194 drafts_root
  - runtime/fuwa-dev.lua:696 build_draft_write_response
  - runtime/fuwa-dev.lua:789 overlay_root draft bundle behavior
  - runtime/openresty/deploy/deploy_handler.lua:28 reading .fuwa-dev/drafts/
    current

  Those should stop owning live state.

  What should replace /draft
  Nothing for live reload.

  For live reload:

  - source of truth = browser memory

  Only explicit actions should cross the backend boundary:

  - Deploy
  - later maybe Save or Publish

  And when they do, the browser should send a snapshot of the current in-memory
  files, not rely on server disk overlays.

  So how do we do Deploy in that model?
  Not by reading disk.

  Do this instead:

  1. user clicks Deploy
  2. browser asks runtime-session for current in-memory source snapshot
  3. browser sends that snapshot to backend
  4. backend stores it in SQLite
  5. backend compiles from that snapshot or from the SQLite row
  6. backend stores compiled deploy in SQLite
  7. backend redirects to /p/<slug>/

  That preserves:

  - browser-owned live state
  - backend-owned explicit persistence

  What to implement next if you want this architecture

  1. Remove draft-overlay reads from the browser live path.
  2. Make bundle.json the one-time boot source only.
  3. Keep runtime-session.js as the canonical live state owner.
  4. Add a client-side exportSnapshot() or equivalent on the runtime session.
  5. Make Deploy send the in-memory snapshot to backend.
  6. Store snapshot and deploy artifacts in SQLite.
  7. Stop using .fuwa-dev/drafts entirely.

  Bottom line
  Yes, this is doable.
  Yes, /IDE already proves the pattern.
  And yes, the correct architecture is:

  - live reload = 100% browser/VFS/Wasmoon
  - backend only for explicit persistence
  - no /draft
  - no disk in the live-edit loop


