# THISISWASMOON

This document answers one question only:

> What in `fuwa` runs inside the browser Wasmoon runtime?

## What this covers

This is the live shell preview path:

- editor changes in the shell
- in-memory source state
- browser worker execution
- browser SQLite-WASM state
- iframe tenant rendering

## What runs where

The browser-owned preview loop is:

1. The shell loads a payload bundle from `/runtime/<payload>/bundle.json`.
2. `shell/hooks/runtime-session.js` keeps the canonical in-memory file map.
3. `shell/hooks/preview.js` forwards editor changes into that in-memory session.
4. `shell/hooks/runtime-worker.js` runs Wasmoon in a worker.
5. The worker exposes:
   - `__fuwa_vfs_read`
   - `__fuwa_db_op`
6. The worker DB is browser SQLite-WASM.
7. The tenant iframe renders the result.

## Rules

- Live editing is browser-owned.
- Browser preview state is VFS/in-memory first.
- Browser preview DB state is browser SQLite-WASM.
- Live editing must not depend on backend draft writes.
- The backend is not the source of truth while the user is typing.

## What does not belong here

- OpenResty request handlers
- deploy persistence
- public preview routing
- backend SQLite
- route tracing sink setup

## Current concrete files

- `shell/hooks/runtime-session.js`
- `shell/hooks/runtime-worker.js`
- `shell/hooks/preview.js`
- `shell/hooks/preview-browser.js`
- `shell/hooks/tenant-runtime.js`

This is the Wasmoon/browser side of the system.
