# SigNoz Debugging Notes — Config Validation Failures

Date: 2026-07-24

## Current State

SigNoz core (`signoz/signoz:latest`) crashes on startup with config
validation errors. The infrastructure layer is healthy:

| Component | Status |
|---|---|
| ClickHouse 25.12.5 + Keeper | ✅ Healthy |
| Schema migrator | ✅ Completed |
| OTel ingester (:4317/:4318) | ✅ Running |
| Vector, VictoriaMetrics, Fuwa, OpenResty | ✅ All running |

Only `signoz` core failed. Logs showed `failed to validate config "identn"` or
`failed to validate config "user"` depending on env var combination.

## Files Changed (relative to uptrace stack)

```
NEW:  infra/docker-compose/signoz.yml
NEW:  infra/docker-compose/signoz/ingester.yaml
NEW:  infra/docker-compose/signoz/opamp.yaml
NEW:  infra/docker-compose/signoz/keeper-0.yaml
NEW:  infra/docker-compose/signoz/clickhouse-config-0-0.yaml
NEW:  infra/docker-compose/telemetry.yml
MOD:  infra/docker-compose/dev.yml           (include signoz + telemetry)
MOD:  infra/docker-compose/vector.toml       (removed clickhouse/uptrace sinks)
MOD:  infra/docker-compose/otlp-bridge.py    (removed DSN header, point to signoz-ingester:4318)
MOD:  infra/openresty/dev/nginx.conf         (uptrace routes → signoz route)
MOD:  docs/routes.txt
```

## Root Cause

There were two separate problems:

1. The running container had stale auth-related environment variables that were
   not present in the checked-in compose file. `docker inspect` showed:

   - `SIGNOZ_IDENTN_TOKENIZER_ENABLED=true`
   - `SIGNOZ_IDENTN_IMPERSONATION_ENABLED=true`
   - `SIGNOZ_IDENTN_APIKEY_ENABLED=false`
   - `SIGNOZ_GLOBAL_EXTERNAL__URL=http://localhost:8080/dash/signoz`

   That mixed runtime state triggered SigNoz auth config validation before the
   service could start.

2. The OpenResty SigNoz route stripped `/dash/signoz/` before proxying. SigNoz's
   `SIGNOZ_GLOBAL_EXTERNAL__URL` expects the base path to be forwarded intact.
   Stripping the prefix would break UI asset and API routing even after startup.

3. Root-user bootstrap was failing because the configured password did not pass
   SigNoz's user validation. A strong password such as `FuwaDemoAdmin1!` allows
   the root-user and impersonation bootstrap path to proceed on `v0.134.0`.

4. Enabling impersonation on an existing `signoz_meta` volume was the wrong
   install state for the documented flow. Recreating the `signoz_meta` volume
   allowed SigNoz to provision the root user on startup and then enable
   impersonation cleanly.

## What Reproduced Reliably

- `v0.134.0` and `v0.133.0` both boot cleanly with:
  - SQLite metastore
  - ClickHouse telemetrystore
  - `SIGNOZ_GLOBAL_EXTERNAL__URL`
  - `SIGNOZ_TOKENIZER_JWT_SECRET`
  - no root-user or impersonation overrides

- The same images fail validation when root-user or impersonation env vars are
  layered on top. That makes the current safe repo fix:
  - pin the working image version
  - remove auth-mode guessing from compose
  - set the required JWT secret explicitly
  - align the reverse proxy with SigNoz external URL behavior

## Reference Config (from SigNoz example.yaml)

The full example config is at:
https://raw.githubusercontent.com/SigNoz/signoz/main/conf/example.yaml

The identn section:
```yaml
identn:
  tokenizer:
    enabled: true
    headers:
      - Authorization
      - Sec-WebSocket-Protocol
  apikey:
    enabled: true
    headers:
      - SIGNOZ-API-KEY
  impersonation:
    enabled: false
```

The user section:
```yaml
user:
  password:
    reset:
      allow_self: true
      max_token_lifetime: 6h
    invite:
      max_token_lifetime: 48h
  root:
    enabled: false
    email: ""
    password: ""
    org:
      name: default
      id: 00000000-0000-0000-0000-000000000000
```

## Implemented Fix

1. Pin `signoz/signoz` to `v0.134.0` instead of `latest`.
2. Set `SIGNOZ_GLOBAL_EXTERNAL__URL` explicitly.
3. Set `SIGNOZ_TOKENIZER_JWT_SECRET` explicitly.
4. Configure the documented impersonation env vars:
   - `SIGNOZ_USER_ROOT_ENABLED=true`
   - `SIGNOZ_USER_ROOT_EMAIL=admin@fuwa.local`
   - `SIGNOZ_USER_ROOT_PASSWORD=FuwaDemoAdmin1!`
   - `SIGNOZ_USER_ROOT_ORG_NAME=default`
   - `SIGNOZ_IDENTN_IMPERSONATION_ENABLED=true`
   - `SIGNOZ_IDENTN_TOKENIZER_ENABLED=false`
   - `SIGNOZ_IDENTN_APIKEY_ENABLED=false`
5. Recreate the `signoz_meta` volume so root-user bootstrap runs on a fresh install.
6. Stop stripping `/dash/signoz/` in OpenResty.

This now solves no-auth access on the current stack. Verification:

- `docker logs docker-compose-signoz-1` shows:
  `impersonation identity provider is enabled, all requests will impersonate the root user`
- `GET /dash/signoz/api/v1/global/config` returns:
  - `identN.tokenizer.enabled: false`
  - `identN.apikey.enabled: false`
  - `identN.impersonation.enabled: true`

## Docker Compose Snippet (current signoz service)

```yaml
signoz:
  image: signoz/signoz:latest
  ports:
    - "8082:8080"
  environment:
    SIGNOZ_SQLSTORE_PROVIDER: sqlite
    SIGNOZ_SQLSTORE_SQLITE_PATH: /var/lib/signoz/signoz.db
    SIGNOZ_TELEMETRYSTORE_PROVIDER: clickhouse
    SIGNOZ_TELEMETRYSTORE_CLICKHOUSE_DSN: tcp://signoz-clickhouse:9000
  volumes:
    - signoz_meta:/var/lib/signoz
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/api/v1/health"]
    interval: 30s
    retries: 3
    start_period: 60s
    timeout: 10s
  depends_on:
    signoz-clickhouse:
      condition: service_healthy
    signoz-migrator:
      condition: service_completed_successfully
  restart: unless-stopped
```

Current full compose: `infra/docker-compose/signoz.yml`

## To Reproduce

```bash
cd /mnt/DATA/development/projects/repos/fuwa-infra-exploration
docker compose -f infra/docker-compose/dev.yml up -d signoz
docker logs docker-compose-signoz-1
```
