# SigNoz Implementation Plan

Date: 2026-07-24

## Key Corrections from Research

Two claims in the migration plan were wrong:

| Wrong Claim | Truth |
|---|---|
| "Neither product supports no auth" | SigNoz has **Impersonation Mode** (v0.126.0+): no login screen, no sign-up, every request is admin. Network perimeter is the only access control. |
| "Uptrace is gRPC-only for OTLP" | Uptrace supports both OTLP/gRPC and OTLP/HTTP. The friction was the DSN header, not the transport. |

Also: SigNoz's subpath proxying is a **first-class feature** via
`SIGNOZ_GLOBAL_EXTERNAL__URL`. This means `/dash/signoz/` will actually work
without the asset-path hacks uptrace needed.

---

## 1. Architecture Decision

### SigNoz with standard auth first, impersonation later

```
Current repo-safe path:
  - Keep standard SigNoz auth enabled
  - Pin a verified working image version
  - Set external URL and JWT secret explicitly
  - Revisit impersonation only after upstream root-user bootstrap works
```

This still eliminates Uptrace, PostgreSQL, and Redis. It does not yet eliminate
interactive login friction.

### Stack after migration

```
openresty        — reverse proxy (:8080, routes /, /dash/signoz/, etc.)
fuwa             — app
vector           — telemetry router
python-bridge    — JSON → OTLP (point to SigNoz, no DSN header needed)
signoz           — dashboard + ingestion (replaces uptrace)
clickhouse       — telemetry storage (new instance, 25.x+)
clickhouse-keeper— SigNoz requirement for CH coordination
victoriametrics  — metrics

REMOVED: uptrace, postgres, redis
```

## 2. Implementation Steps

### Step 1: Generate SigNoz Compose via Foundry

SigNoz deprecated raw compose files. Use Foundry once to generate them:

```bash
# Install Foundry
curl -fsSL https://signoz.io/foundry.sh | bash

# Create casting.yaml
cat > casting.yaml << 'EOF'
apiVersion: v1alpha1
kind: Installation
metadata:
  name: signoz
spec:
  deployment:
    flavor: compose
    mode: docker
EOF

# Generate compose files (don't start yet)
foundryctl forge -f casting.yaml
# Output goes to pours/deployment/
```

### Step 2: Extract and Customize

Pull the generated compose files into our repo structure:

```bash
cp pours/deployment/compose.yaml infra/docker-compose/signoz.yml
```

Then hand-edit `signoz.yml` to:
- Pin ClickHouse to 25.12.x
- Set metastore to **SQLite** (not PostgreSQL)
- Pin `signoz/signoz` to a verified working release
- Set external URL for subpath proxying
- Set `SIGNOZ_TOKENIZER_JWT_SECRET`
- Set resource limits appropriate for dev
- Remove Cloud-specific services (MCP, billing, etc.)

### Step 3: SigNoz Configuration

Minimal working config via environment variables in the compose file:

```yaml
environment:
  # Metadata: use SQLite, not PostgreSQL
  SIGNOZ_SQLSTORE_PROVIDER: "sqlite"
  SIGNOZ_SQLSTORE_SQLITE_PATH: "/var/lib/signoz/signoz.db"

  # Subpath: serve at /dash/signoz/
  SIGNOZ_GLOBAL_EXTERNAL__URL: "http://localhost:8080/dash/signoz"
  SIGNOZ_TOKENIZER_JWT_SECRET: "..."

  # Telemetry: point at ClickHouse
  SIGNOZ_TELEMETRYSTORE_PROVIDER: "clickhouse"
  SIGNOZ_TELEMETRYSTORE_CLICKHOUSE_DSN: "tcp://clickhouse:9000"
```

### Step 4: Remove Uptrace Dependencies

Files to remove from compose:
```
infra/docker-compose/observability.yml: remove uptrace, postgres, redis
```

Files to move to `_deprecated/uptrace/`:
```
infra/docker-compose/uptrace/config.yml
infra/docker-compose/uptrace/
infra/openresty/dev/nginx.conf  (auto-login Lua shim — no longer needed)
docs/infra/uptrace-no-typing-access-plan.md
```

### Step 5: Update OpenResty

Replace the uptrace auto-login route with a simple SigNoz proxy:

```nginx
# SigNoz dashboard — preserve the base path SigNoz was configured with
location /dash/signoz/ {
    set $signoz_upstream signoz:8080;
    proxy_pass http://$signoz_upstream;
    proxy_set_header Host $host;
}
```

No Lua block. No path rewrite.

### Step 6: Update Python Bridge

Replace uptrace DSN header with clean OTLP HTTP POST:

```python
# Before (Uptrace)
UPTRACE_URL = "http://uptrace:14318/v1/traces"
UPTRACE_DSN = "http://fuwa_telemetry_demo@uptrace:14317/1"
req.add_header("uptrace-dsn", UPTRACE_DSN)

# After (SigNoz)
SIGNOZ_URL = "http://signoz-otel-collector:4318/v1/traces"
# No DSN header. No auth header. Just POST.
```

### Step 7: Wire Everything Up

Update `infra/docker-compose/dev.yml`:
```yaml
include:
  - app.dev.yml
  - openresty.yml
  - signoz.yml          # replaces uptrace + postgres + redis
  - vector.yml          # keep vector and victoriametrics
```

### Step 8: Bring Up and Verify

```bash
docker compose -f infra/docker-compose/dev.yml up -d
```

Verify:
1. `http://localhost:8080/dash/signoz/` loads
2. `http://localhost:8080/dash/signoz/traces` shows seeded data
3. Generate real traffic via fuwa → traces appear

## 3. Files Changed Summary

| Action | File |
|---|---|
| **NEW** | `infra/docker-compose/signoz.yml` |
| **MODIFY** | `infra/docker-compose/dev.yml` (include signoz, remove observability) |
| **MODIFY** | `infra/docker-compose/otlp-bridge.py` (SigNoz endpoint, no DSN) |
| **MODIFY** | `infra/openresty/dev/nginx.conf` (SigNoz route, remove auto-login) |
| **MODIFY** | `docs/routes.txt` |
| **MODIFY** | `Tiltfile` (if needed) |
| **DELETE** | `infra/docker-compose/uptrace/` → `_deprecated/` |
| **DELETE** | `infra/docker-compose/observability.yml` (uptrace/postgres/redis sections) |
| **DELETE** | `infra/docker-compose/clickhouse/config.d/002-json.xml` (JSON type hack for uptrace) |

## 4. Open Questions

1. **ClickHouse instance: reuse or separate?** SigNoz requires ClickHouse 25.x
   and a cluster named `cluster` with Keeper coordination. Our existing 24.12
   standalone won't work. Simplest path: let SigNoz manage its own ClickHouse.

2. **VictoriaMetrics: keep or drop?** SigNoz has built-in Prometheus metrics.
   VictoriaMetrics is redundant but harmless. Decision: keep for now.

3. **Foundry one-shot vs ongoing?** Use Foundry once to generate the compose,
   then manage it manually going forward (same pattern as current setup).

4. **Resource limits?** SigNoz recommends 4GB minimum. Current dev machine has
   enough headroom. Monitor after migration.
