# Next Steps — Ansible hardening & edge case testing

## Gap: what Ansible doesn't verify today

Post-bootstrap, the only health check is `curl http://localhost:8080/` — which just proves
OpenResty is alive. Everything else is blind:

| What's not checked | Why it matters |
|-------------------|----------------|
| DNS propagated to `fuwa.<domain>` | Let's Encrypt fails silently |
| Each container healthy | ClickHouse could be OOM, ingester could be crash-looping |
| Dashboard proxies work | `/dash/signoz/` could 502 |
| Trace data actually flowing | Pipeline silently broken |
| ClickHouse memory under cap | OOM cascade blocks all writes |
| Signoz UI seeded correctly | Empty dashboards with no data |
| Logs reaching ClickHouse | `emit_log` dead path |
| Loadtest generates expected volume | Silent pipeline drops under load |
| System survives saturation | No way to find the breaking point before production |

## Step 0: DigitalOcean monitoring (Terraform)

One line in `droplet.tf`. DO polls the hypervisor — works even if the app is
completely crashed. No agent, no cloud-init change, free.

```hcl
resource "digitalocean_droplet" "fuwa" {
  # ... existing config ...
  monitoring = true   # ← add this
}
```

You get CPU, memory, disk, network graphs in the DO dashboard regardless of
app health. If stress testing saturates the VM, you can see the kill shot in
the DO metrics even when SSH/HTTP are dead.

## Step 1: Profile-based loadtest architecture

### Problem today
`load.yml` and `k6.yml` are included in `dev.yml` → every `docker compose up`
starts 6 loadtest containers that run 24/7. They burn CPU, generate garbage
telemetry, and prevent clean verification runs.

### Fix: profiles + explicit compose files

Remove `load.yml` and `k6.yml` from `dev.yml` includes. They stay in
`infra/docker-compose/` but are NOT part of the default include chain.
Add `profiles: [loadtest]` to every service in both files.

**Files to change:**

| File | Change |
|------|--------|
| `infra/docker-compose/dev.yml` | Remove `- load.yml` and `- k6.yml` from includes |
| `infra/docker-compose/load.yml` | Add `profiles: [loadtest]` to `loadtest-traces` and `loadtest-fuwa` |
| `infra/docker-compose/k6.yml` | Add `profiles: [loadtest]` to all 4 k6 services |
| `infra/k6/fuwa-stress.js` | Add `stress` scenario (see Step 4 below) |

**New behavior:**

```bash
# Normal startup: zero loadtest containers
docker compose up -d

# Ansible verify: explicitly merge loadtest files
docker compose \
  -f docker-compose.yml \
  -f docker-compose/load.yml \
  -f docker-compose/k6.yml \
  --profile loadtest \
  up -d <service-name>

# Teardown after tests
docker compose --profile loadtest down
```

Each test run is clean — fresh trace IDs, fresh metrics, no stale data.

## Step 2: verify.yml — post-deploy health check playbook

Create `infra/ansible/playbooks/verify.yml` with 4 phases. Runs after bootstrap.
Idempotent. Fails loudly with diagnostic output.

### Phase 1: DNS propagation

```yaml
- name: DNS — A record
  assert: dig +short fuwa.{{ domain }} == droplet IPv4
  retries: 12, delay: 10s   # 2 minute timeout for Cloudflare propagation

- name: DNS — wildcard
  assert: dig +short test.fuwa.{{ domain }} == droplet IPv4
```

### Phase 2: Container health

```yaml
- name: All containers running
  docker ps --format '{{.Names}} {{.Status}}' | assert each:
    openresty          → healthy
    signoz-clickhouse  → healthy
    signoz             → healthy
    signoz-ingester    → Up
    signoz-keeper      → healthy
    vector-router      → Up
    victoriametrics    → Up
    signoz-migrator    → exited 0
    signoz-bootstrap   → exited 0

- name: ClickHouse memory under 2 GB
  docker stats signoz-clickhouse --no-stream → parse, assert < 2.1 GB

- name: ClickHouse accepting queries
  clickhouse-client --query "SELECT 1" → assert "1"

- name: No MEMORY_LIMIT_EXCEEDED in logs
  docker logs signoz-clickhouse --since 5m | assert not contains "MEMORY_LIMIT"
```

### Phase 3: HTTP endpoints (with retries)

```yaml
- name: Fuwa app
  curl http://localhost:8080/ → 200

- name: SigNoz dashboard proxy
  curl http://localhost:8080/dash/signoz/ → 302
  retries: 20, delay: 5s   # SigNoz start_period is 60s

- name: VictoriaMetrics proxy
  curl http://localhost:8080/dash/vmetrics/ → 200

- name: ClickHouse Play proxy
  curl http://localhost:8080/dash/clickhouse/ → 200

- name: Vector API proxy
  curl http://localhost:8080/dash/vector/ → 200

- name: Trace endpoint
  curl http://localhost:8080/__dev/traces → 200, valid JSON
```

### Phase 4: End-to-end observability

This is where the loadtest profiles matter. verify.yml generates controlled
traffic, waits for it to flow through the entire pipeline, then validates.

```yaml
# 4a. Record baseline trace count
- name: Baseline trace count
  clickhouse-client --query "SELECT count() FROM signoz_traces.distributed_signoz_index_v2"
  register: baseline_count

# 4b. Start loadtest generators
- name: Start loadtest
  shell: |
    docker compose \
      -f /opt/fuwa/infra/docker-compose.yml \
      -f /opt/fuwa/infra/docker-compose/load.yml \
      -f /opt/fuwa/infra/docker-compose/k6.yml \
      --profile loadtest \
      up -d k6-edges loadtest-fuwa

# 4c. Wait for test completion (k6-edges: ~2 min, 50 iterations per VU)
- name: Wait for k6-edges
  shell: |
    for i in $(seq 1 30); do
      docker ps --filter name=k6-edges --filter status=exited --format '{{.Names}}' | grep -q k6-edges && exit 0
      sleep 5
    done
    exit 1

# 4d. Wait for traces to flush (batch processor: 5s timeout)
- name: Wait for batch flush
  pause: seconds=15

# 4e. Verify trace increase
- name: Trace count increased
  clickhouse-client --query "SELECT count() FROM signoz_traces.distributed_signoz_index_v2"
  register: final_count
  assert: final_count > baseline_count

# 4f. Verify specific traces exist
- name: k6 traces in ClickHouse
  clickhouse-client --query "
    SELECT count() FROM signoz_traces.distributed_signoz_index_v2
    WHERE timestamp > now() - INTERVAL 5 MINUTE
    AND httpRoute LIKE '%_src=k6%'"
  assert: count > 0

# 4g. Verify logs
- name: Logs in ClickHouse
  clickhouse-client --query "
    SELECT count() FROM signoz_logs.logs_v2
    WHERE timestamp > toUnixTimestamp(now() - INTERVAL 5 MINUTE) * 1000000000"
  assert: count > 0

# 4h. Signoz dashboards exist and have widgets
- name: Dashboards seeded
  curl http://localhost:8080/api/v1/dashboards | assert:
    "Fuwa Overview" present
    "Fuwa Errors" present
    "Fuwa Request Latency" present

# 4i. Clean up
- name: Stop loadtest
  shell: |
    docker compose -f /opt/fuwa/infra/docker-compose.yml \
      -f /opt/fuwa/infra/docker-compose/load.yml \
      -f /opt/fuwa/infra/docker-compose/k6.yml \
      --profile loadtest down
```

## Step 3: verify.yml integration

Wire into the flow at every level:

### bootstrap.yml — run verify after bootstrap

```yaml
# At end of bootstrap.yml
- name: Run post-deploy verification
  ansible.builtin.import_playbook: verify.yml
```

### deploy.fuwa — minimal smoke test on every cron cycle

```bash
# After docker compose up -d, before marking success:
docker compose exec -T signoz-clickhouse clickhouse-client --query "SELECT 1" || exit 1
curl -sf http://localhost:8080/dash/signoz/ > /dev/null || exit 1
curl -sf http://localhost:8080/dash/vmetrics/ > /dev/null || exit 1
```

## Step 4: k6 stress scenario — find the saturation point

Add to `infra/k6/fuwa-stress.js` under `options.scenarios`:

```javascript
stress: {
  executor: "ramping-arrival-rate",
  startRate: 10,                    // 10 iterations/sec
  timeUnit: "1s",
  preAllocatedVUs: 20,
  maxVUs: 500,
  stages: [
    { duration: "1m", target: 50 },    // 50 req/s  — normal
    { duration: "1m", target: 100 },   // 100 req/s — loaded
    { duration: "1m", target: 200 },   // 200 req/s — degraded
    { duration: "1m", target: 400 },   // 400 req/s — breaking
    { duration: "1m", target: 600 },   // 600 req/s — broken
    { duration: "30s", target: 0 },
  ],
  exec: "hitFuwa",
  startTime: "0s",
},
```

This uses `ramping-arrival-rate` (RPS control) instead of `ramping-vus`
(concurrent user control). More predictable for finding the exact breaking
point.

Expected behavior as it ramps:

| RPS | What happens |
|-----|-------------|
| 50 | Normal — all traces arrive, p95 < 100ms |
| 100 | Loaded — slight latency increase |
| 200 | Degraded — `ngx.timer.at` queue starts filling, occasional trace drops |
| 400 | Breaking — worker connections exhausted (1024 default), 502s appear |
| 600 | Broken — connection refused, ClickHouse OOM from accumulated unflushed parts |

Add to `k6.yml`:

```yaml
k6-stress:
  image: grafana/k6:latest
  profiles: [loadtest]
  command:
    - run
    - --env SCENARIO=stress
    - --env BASE_URL=http://openresty:${PORT:-8080}
    - /scripts/fuwa-stress.js
  volumes:
    - ../../infra/k6:/scripts:ro
  depends_on:
    openresty:
      condition: service_healthy
```

### Post-stress verification in verify.yml

```yaml
- name: k6-stress completed
  docker ps --filter name=k6-stress --filter status=exited | assert exists

- name: k6 exit code 0 (no crash)
  docker inspect k6-stress --format '{{.State.ExitCode}}' | assert "0"

- name: Trace count ≥ 90% of requests sent
  Compare k6 output counter vs ClickHouse trace increase.
  10% loss acceptable under extreme load.

- name: No containers restarted during test
  docker ps --filter status=exited | assert only expected ones (migrator, bootstrap)

- name: OpenResty recovered within 30s of test end
  retries: 6, delay: 5s
  curl http://localhost:8080/ → 200

- name: ClickHouse still under 2 GB
  docker stats signoz-clickhouse --no-stream → assert < 2.1 GB
```

## Step 5: Edge case tests

### 5a. ClickHouse OOM recovery

```
1. Artificially fill memory: heavy query (cartesian join on system.numbers)
2. Assert MEMORY_LIMIT_EXCEEDED in logs
3. Assert new traces STILL get stored (ingester retries work)
4. Kill the query
5. Assert ClickHouse recovers within 30s
6. Assert merges still disabled (SYSTEM STOP MERGES persisted)
```

### 5b. Ingester restart mid-write

```
1. Send 100 rapid traces via curl
2. Mid-batch: docker restart signoz-ingester
3. Assert ingester comes back healthy
4. Assert ALL 100 traces appear in ClickHouse within 60s
```

### 5c. OpenResty restart

```
1. docker restart openresty during active requests
2. Assert comes back healthy
3. Assert traces continue flowing
```

### 5d. DNS failure simulation

```
1. docker network disconnect fuwa_default signoz-clickhouse
2. Assert ingester logs show connection errors
3. Assert OpenResty still serves (app is independent of ClickHouse)
4. docker network connect fuwa_default signoz-clickhouse
5. Assert full pipeline recovers within 30s
```

### 5e. Disk pressure

```
1. Fill /tmp to 80% usage
2. Assert ClickHouse continues accepting writes
3. Assert OpenResty continues serving
4. Clean up
```

### 5f. Bootstrap marker validation

```
1. Delete /var/lib/signoz-bootstrap/.seeded
2. docker compose restart signoz-bootstrap
3. Assert dashboards re-created with widgets
4. Assert trace count unchanged (no data loss)
```

## Step 6: Monitoring checklist

| Metric | Command | Alert if |
|--------|---------|----------|
| DO droplet alive | DO dashboard (monitoring=true) | CPU 100% for 5+ min |
| ClickHouse memory | `docker stats signoz-clickhouse` | > 1.8 GB |
| CH write failures | `docker logs signoz-ingester \| grep MEMORY_LIMIT` | any occurrence |
| Trace throughput | `SELECT count() FROM signoz_traces.signoz_index_v3 WHERE timestamp > now() - INTERVAL 5 MINUTE` | < 1 |
| Vector connectivity | `docker logs vector-router \| grep "Connection refused"` | any in last 5 min |
| OpenResty errors | `docker logs openresty \| grep WARN` | "connect failed" |
| Disk usage | `df -h /` | > 80% |
| Container uptime | `docker ps --filter status=exited` | ingester or clickhouse |

## Priority order

| # | What | Files touched | Effort |
|---|------|--------------|--------|
| 0 | Add `monitoring = true` to droplet.tf | `terraform/droplet.tf` : 1 line | 1 min |
| 1 | Add `profiles: [loadtest]` to load/k6 YAMLs, remove includes from dev.yml | `load.yml`, `k6.yml`, `dev.yml` | 5 min |
| 2 | Add `stress` scenario to k6 script + k6-stress service | `k6/fuwa-stress.js`, `k6.yml` | 10 min |
| 3 | Write `verify.yml` with 4 phases | New file: `ansible/playbooks/verify.yml` | 30 min |
| 4 | Wire verify into bootstrap.yml + deploy.fuwa | `bootstrap.yml`, `deploy.fuwa` | 5 min |
| 5 | Edge case tests (5a-5f) | New files in `ansible/playbooks/` | 1-2 hours |
| 6 | Monitoring checks | Cron or systemd timer on droplet | 15 min |
