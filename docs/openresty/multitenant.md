• Yes, I remember the split you asked for, and no, it has not been implemented
  yet. Right now the repo still mixes browser-runtime concerns and OpenResty/
  server concerns in a way that makes this easy to misunderstand.

  What I gathered:

  - In /IDE, the live editor preview is browser-owned:
      - Wasmoon runs in the worker
      - VFS is in memory
      - browser SQLite handles preview DB state
      - Lua only sees __fuwa_db_op(command), never a raw DB
  - In /IDE, the public preview/play route is not browser Wasmoon.
      - It runs server-side
      - it still uses the same DB provider contract
      - the preview runtime injects a real __fuwa_db_op backed by a provider
        plus tenantKey
  - In fuwa, shell preview follows that browser model already.
  - In fuwa, /p/<slug> currently runs server-side in OpenResty, but its DB
    bridge is still a fake no-op:
      - runtime/openresty/deploy/preview_handler.lua:57

  So the missing piece is not “invent a new preview architecture”. The missing
  piece is much smaller:

  - keep browser preview browser-owned
  - keep public preview server-owned
  - give server preview a real DB provider with a tenant/deployment key

  YAGNI answer

  The smallest sane design is:

  1. Shell/live preview:
      - runs in Wasmoon
      - uses browser SQLite-WASM
      - no backend writes during editing
  2. Deploy/public preview /p/<slug>:
      - runs in OpenResty
      - uses backend SQLite
      - DB is scoped by preview slug or deployment id
  3. Shared contract:
      - both runtimes use the same logical DB verb boundary:
      - all, find, find_by, where, create, update, delete

  That is exactly the part from /IDE worth copying.

  What I would not do:

  - do not run Wasmoon inside /p/<slug>
  - do not make public preview talk back to the browser DB
  - do not invent a second weird preview-only DB API
  - do not over-generalize multitenancy yet

  The simplest multitenant key
  For deployed preview, use:

  - tenant_key = "preview:" .. slug

  That gives you:

  - isolated DB state per deployed preview
  - no collisions
  - no “current draft” nonsense
  - no need to design full user/project tenancy yet

  Later, if you want shared app state, you can change the key model. But for now
  this is the most YAGNI choice.

  Why /IDE matters here

  In /IDE, the important idea is not Wasmoon itself. The important idea is:

  - Lua gets a narrow __fuwa_db_op
  - the host/runtime decides which provider handles it
  - provider gets a tenant context

  That means in fuwa public preview, the right move is:

  - keep runtime/stdlib/db.lua untouched
  - keep app code untouched
  - replace the no-op bridge in preview_handler.lua
  - route ops into the backend SQLite provider with a preview tenant key

  Folder structure

  I would not hide this under only runtime/openresty/deploy/. The confusion is
  bigger than deploy. You want the runtime model visible at the top.

  I would use:

  runtime/
    browser/
      worker/
      session/
      db/
      preview/

    openresty/
      routes/
      deploy/
      preview/
      db/
      tracing/

    stdlib/

  More concretely:

  runtime/
    browser/
      db/
        sqlite_wasm.lua-contract.md
      worker/
        boot.lua
        vfs.lua
      session/
        protocol.lua
      preview/
        tenant_contract.lua

    openresty/
      routes/
        handler.lua
        traces.lua
      deploy/
        deploy_handler.lua
        store.lua
      preview/
        preview_handler.lua
        public_shell.lua
        db_bridge.lua
      db/
        preview_provider.lua
      tracing/
        sink.lua

  And for JS:

  shell/hooks/
    browser/
      runtime-worker.js
      runtime-session.js
      preview-browser.js
      tenant-runtime.js

    shell/
      editor.js
      terminal.js
      workspace.js
      observability.js

  That split is clean:

  - runtime/browser/ = things needed because code runs in Wasmoon/browser
  - runtime/openresty/ = things needed because code runs on server/OpenResty

  Docs

  Yes, you need these docs. Otherwise this will keep rotting.

  I would add exactly two top-level runtime docs:

  - docs/runtime/THISISWASMOON.md
  - docs/runtime/THISRUNSAGAINSTDB.md

  And each should answer one question only.

  THISISWASMOON.md

  - live shell preview
  - browser worker
  - VFS
  - browser SQLite-WASM
  - no backend writes during editing

  THISRUNSAGAINSTDB.md

  - deployed/public preview
  - OpenResty execution
  - backend SQLite
  - tenant/deployment key rules
  - tracing requirement on every route

  That is better than burying the truth in deploy notes.

  My recommendation
  Do this in order:

  1. Add a real OpenResty preview DB bridge for /p/<slug>
      - no more no-op __fuwa_db_op
      - use backend SQLite
      - tenant key = preview:<slug>
  2. Add the two runtime docs
      - browser runtime
      - server runtime
  3. Do the folder split
      - only after the behavior is correct
      - otherwise you refactor confusion instead of reducing it

  So the answer is: yes, we should keep this YAGNI, and the YAGNI solution is
  not “make everything Wasmoon”. It is:

  - Wasmoon for live editing
  - OpenResty + SQLite for deployed preview
  - same DB command contract on both sides
  - explicit browser/server folder split
  - explicit docs naming what runs where

  And yes, current worktree is still clean on branch ui-redesign-sqlite-
  implementation.
