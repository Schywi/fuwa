# Wasmoon VFS, Server State, and SQLite

## Current problem

The current deploy/dev architecture mixes two conflicting models:

1. **Browser runtime model**
   - Code is edited in the browser.
   - Code is executed in the browser Wasmoon session.
   - Live preview updates are driven from the browser's in-memory VFS.
   - This makes the browser's in-memory state the effective working source of truth.

2. **Server persistence model**
   - Drafts are written to `.fuwa-dev/drafts/...` on disk.
   - Deploy reads payload source from disk.
   - Deployment artifacts were being written to JSON files on disk.

That split is conceptually wrong for the Wasmoon-driven editor workflow.

## Conclusion

If the user is editing and running code in Wasmoon, it does **not** make sense for
every meaningful state transition to depend on server-side disk writes.

For the interactive editor/runtime flow:

- **Browser VFS should own the working set**
- **Server should only receive an explicit snapshot**
- **Disk writes are not an acceptable primary persistence mechanism**

## Desired model

### While editing

- Code lives in the browser Wasmoon/VFS session.
- Preview runs from browser memory.
- No server disk writes.
- No `.fuwa-dev/drafts/...` dependency for normal live editing.

### On explicit actions (`Deploy`, later maybe `Save`/`Publish`)

- The browser sends the current in-memory source snapshot to the backend.
- The backend persists that snapshot in SQLite.
- The backend compiles from that persisted or directly received snapshot.
- The backend stores deploy records in SQLite.
- The backend redirects to the deployed preview URL.

This keeps the browser fast and local while still allowing explicit persistence.

## SQLite requirement

**Deployment and draft persistence should use SQLite, not ad-hoc files on disk.**

Specifically:

- Do **not** store deployments as JSON files in a folder.
- Do **not** use `.fuwa-dev/drafts/...` as the canonical persistence layer.
- Do **not** rely on server-side source files on disk as the deploy source of truth.

Instead:

- Store draft/source snapshots in SQLite.
- Store deployment metadata in SQLite.
- Store compiled output in SQLite.

## Recommended backend shape

Use an OpenResty-backed SQLite persistence layer.

### Server responsibilities

OpenResty should expose endpoints that:

1. accept a source snapshot from the browser
2. store that snapshot in SQLite
3. compile it
4. store the compiled output in SQLite
5. redirect or respond with the preview URL

This means the persistence logic belongs on the **backend**, with OpenResty
handlers calling a SQLite-backed storage layer.

## Practical implementation direction

### 1. Add a SQLite-backed deploy store

Replace file-based deploy storage with a SQLite-backed module, for example:

- `runtime/openresty/deploy/store_sqlite.lua`

This module should own:

- saving deployments
- loading deployments by slug
- listing deployments by session
- saving source snapshots

### 2. Send browser state explicitly on deploy

The browser should send the current in-memory source snapshot from Wasmoon/VFS to
the backend when `Deploy` is clicked.

That means:

- the deploy action is explicit
- the server is not scraping disk state to guess current source
- deploy uses what the user actually has in memory

### 3. Preview reads compiled deployment from SQLite

`/p/{slug}` should load the compiled deployment from SQLite, not from JSON files
on disk.

## Answer to the architectural question

### Should we use SQLite to save the data?

**Yes.**

### Where should that happen?

On the **backend**.

### How?

By implementing an OpenResty server-side persistence layer that writes to SQLite.

That means:

- **yes**, likely an OpenResty Lua storage module
- **yes**, the backend should own persistence
- **no**, the browser should not be writing files to disk

## Final position

- Wasmoon/VFS should own live working state.
- Deploy should send an explicit snapshot to the backend.
- Backend should persist snapshots and deployments in SQLite.
- Writing deploy/draft state to disk files is not the right architecture here.
