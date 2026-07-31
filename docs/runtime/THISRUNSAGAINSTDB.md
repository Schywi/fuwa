# THISRUNSAGAINSTDB

This document answers one question only:

> What in `fuwa` runs server-side and talks to backend SQLite?

## What this covers

This is the deployed/public preview path:

- `/__dev/deploy`
- `/p/<slug>/`
- `/p/<slug>/?app=1`
- OpenResty route execution
- backend SQLite persistence

## What runs where

The server-owned preview loop is:

1. The browser sends an explicit deploy snapshot to `/__dev/deploy`.
2. OpenResty stores the deployment artifact in backend SQLite.
3. The public landing page lives at `/p/<slug>/`.
4. The iframe app route lives at `/p/<slug>/?app=1`.
5. OpenResty executes compiled Lua for public preview requests.
6. Public preview DB calls use backend `sqlite_local`.
7. Public preview DB state is scoped by:
   - `tenant_key = "preview:<slug>"`

## Rules

- Public preview is not Wasmoon.
- Public preview is not the shell runtime.
- Public preview must use a real backend DB bridge.
- The Lua-side DB contract stays the same:
  - `all`
  - `find`
  - `find_by`
  - `where`
  - `create`
  - `update`
  - `delete`
- Every OpenResty route must emit tracing.

## What does not belong here

- browser VFS ownership
- in-browser SQLite-WASM
- live typing loop
- shell widget lifecycle

## Current concrete files

- `runtime/openresty/deploy/deploy_handler.lua`
- `runtime/openresty/deploy/store.lua`
- `runtime/openresty/deploy/db_config.lua`
- `runtime/openresty/deploy/preview_handler.lua`
- `runtime/openresty/preview/db_bridge.lua`
- `runtime/openresty/tracing/sink.lua`

This is the OpenResty/backend SQLite side of the system.
