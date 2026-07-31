# runtime/openresty/preview

Server-side public preview concerns live here.

This directory is for code that exists because `/p/<slug>` runs inside
OpenResty, not inside the browser Wasmoon worker.

Examples:

- preview route DB bridges
- public preview HTML wrappers
- request-path rebasing for deployed previews
