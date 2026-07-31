# runtime/browser

Ownership marker for browser-only runtime concerns.

Put code here when it exists because the runtime executes in:

- the browser main thread
- a Web Worker
- the tenant iframe

Examples:

- Wasmoon worker boot logic
- browser VFS helpers
- browser SQLite-WASM contracts
- browser preview session contracts

Do not put OpenResty routes or backend SQLite persistence here.
