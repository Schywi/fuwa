# runtime/openresty

Ownership marker for server-side OpenResty runtime concerns.

Put code here when it exists because the runtime executes inside OpenResty:

- HTTP routes
- deploy/public preview serving
- backend SQLite bridges
- SSE and tracing setup

Do not put browser Wasmoon runtime ownership here.
