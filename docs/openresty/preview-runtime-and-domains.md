# OpenResty Preview Runtime and Domain Wiring

This note documents two things:

1. what `/p/<slug>` actually runs today
2. how a multi-domain OpenResty deployment should be wired on one VPS

## Short answer

The deployed preview iframe is **not** Wasmoon.

The live shell preview and the public deployed preview are two different runtimes:

- **shell/live preview**:
  - browser-owned
  - Wasmoon worker
  - in-memory VFS
  - browser SQLite-WASM
- **public deployed preview**:
  - server-owned
  - OpenResty executes compiled Lua
  - backend SQLite via `sqlite_local`
  - tenant scope = `preview:<slug>`

## What `/p/<slug>` does

The route is implemented in
[runtime/openresty/deploy/preview_handler.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/openresty/deploy/preview_handler.lua:1).

It has two surfaces:

- `/p/<slug>/`
  - marketing / landing page
  - built from `payloads/preview-landing`
- `/p/<slug>/app`
  - actual deployed app iframe route
  - OpenResty runs the compiled deployment artifact

The important line is the DB bridge injection:

- [runtime/openresty/deploy/preview_handler.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/openresty/deploy/preview_handler.lua:54)
  - `_G.__fuwa_db_op = db_bridge`

That bridge comes from:

- [runtime/openresty/preview/db_bridge.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/openresty/preview/db_bridge.lua:1)

And that bridge uses:

- [runtime/db/providers/sqlite_local.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/db/providers/sqlite_local.lua:1)

So today the deployed preview iframe is a normal server-side route against a
real backend SQLite store, not a browser Wasmoon runtime.

## DB model for public preview

The current preview bridge uses:

```text
tenant_key = "preview:" .. slug
```

That means each deployed preview gets isolated DB state.

This is intentionally small-scope and YAGNI:

- no draft overlay state
- no browser DB reuse
- no cross-preview state leakage
- no full multi-tenant product model yet

## Deploy flow

The deploy route is:

- [runtime/openresty/deploy/deploy_handler.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/openresty/deploy/deploy_handler.lua:1)

It:

1. accepts a browser snapshot JSON body
2. compiles it server-side
3. stores the deployment artifact in backend SQLite
4. returns a preview URL `/p/<slug>/`

The deployment store is:

- [runtime/openresty/deploy/store.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/openresty/deploy/store.lua:1)

The store itself is SQLite-backed, but that is separate from the per-preview app
data tenant rows used by `/p/<slug>/app`.

## Public shell behavior

The iframe route is wrapped by:

- [runtime/openresty/deploy/public_shell.lua](/mnt/DATA/development/projects/repos/fuwa/.worktrees/fuwa-ui-redesign/runtime/openresty/deploy/public_shell.lua:1)

That module does not run Wasmoon. It only:

- makes the app HTML standalone when needed
- injects link-rebasing script
- keeps root-relative navigation under `/p/<slug>`

## Runtime truth table

```text
Route / Surface            Runtime owner     DB owner
--------------------------------------------------------------
shell preview              browser Wasmoon   browser SQLite-WASM
/runtime/tenant.html       browser tenant    browser runtime session
/__dev/deploy              OpenResty         backend SQLite
/p/<slug>/                 OpenResty         memory for landing payload only
/p/<slug>/app              OpenResty         backend SQLite (preview:<slug>)
```

## Multi-domain OpenResty on one VPS

Yes, one VPS can serve many domains and subdomains.

Typical examples:

- `websiteA.com`
- `websiteB.com`
- `websiteC.com`
- `sub.websiteB.com`

OpenResty/Nginx selects the request target using the `Host` header and
`server_name`.

Example shape:

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name websiteA.com www.websiteA.com;
}

server {
    listen 80;
    listen 443 ssl;
    server_name websiteB.com www.websiteB.com sub.websiteB.com;
}

server {
    listen 80;
    listen 443 ssl;
    server_name websiteC.com;
}
```

## DNS wiring

The simplest practical model is:

- Cloudflare manages DNS
- DigitalOcean only hosts the VPS
- DNS records point to the VPS public IP

Typical records:

- apex:
  - `websiteB.com` -> `A` -> VPS IPv4
- subdomain:
  - `sub.websiteB.com` -> `A` -> VPS IPv4
  - or `CNAME` -> another hostname you own
- `www`:
  - `www.websiteB.com` -> `CNAME` -> `websiteB.com`

## TLS

You need certificate coverage for every hostname you serve.

Common options:

- Cloudflare proxy in front, origin cert on VPS
- or direct Let's Encrypt on the VPS

If you need wildcard subdomains like `*.websiteB.com`, the cert and DNS setup
must cover the wildcard too.

## Recommendation

For this repo, keep the responsibilities separate:

- browser runtime concerns stay browser-owned
- public preview stays OpenResty-owned
- one VPS can front many domains with `server_name`
- Cloudflare/DNS wiring is infrastructure
- preview routing and DB scoping are application/runtime concerns

Do not collapse these into one mental model. That is where most of the confusion
came from.
