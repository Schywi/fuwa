# Three fixes: ClickHouse memory + Ansible TLS timeout + Terratest public reachability

## Fix 1: ClickHouse memory — Docker cgroup limit

### Problem

ClickHouse auto-detects 3.71 GiB host RAM → allocates 1.86 GiB per cache × 5 caches → exceeds total RAM → swap → MEMORY_LIMIT_EXCEEDED. Config-based memory limits (`max_server_memory_usage`, `background_pool_size`) conflict with ClickHouse 25.12.5 defaults and cause `BAD_ARGUMENTS` crash loops.

### Solution: Docker `mem_limit` on the ClickHouse service

Docker enforces 1GB via cgroups. ClickHouse reads the cgroup at startup and auto-scales everything proportionally. Zero ClickHouse config changes.

**Step 1a: Revert clickhouse-config-0-0.yaml to clean state**

Remove ALL of these lines that were added:

```
max_server_memory_usage: 2147483648           ← delete
max_server_memory_usage_to_ram_ratio: 0.5     ← delete
background_pool_size: 1                       ← delete
background_merges_mutations_concurrency_ratio: 1  ← delete
```

Under `merge_tree:` — remove ALL of these:

```
parts_to_delay_insert: 2000                   ← delete
parts_to_throw_insert: 5000                   ← delete
max_bytes_to_merge_at_max_space_in_pool: 1    ← delete
number_of_free_entries_in_pool_to_lower_max_size_of_merge: 2  ← delete
number_of_free_entries_in_pool_to_execute_mutation: 1         ← delete
```

Under `profiles.default` — remove ALL of these:

```
max_memory_usage: 1000000000                  ← delete
max_bytes_before_external_group_by: 500000000 ← delete
max_threads: 2                                ← delete
```

Keep ONLY these additions (they prevent read-only mode when parts accumulate without merges):

```yaml
merge_tree:
  max_suspicious_broken_parts: 10000
  max_parts_in_total: 100000
```

**Step 1b: Add memory limit to signoz.yml**

Under `signoz-clickhouse` service, add:

```yaml
signoz-clickhouse:
  image: clickhouse/clickhouse-server:25.12.5
  # ... existing config stays ...
  mem_limit: 1g
```

Or with deploy syntax (Docker Compose v2+):

```yaml
signoz-clickhouse:
  # ...
  deploy:
    resources:
      limits:
        memory: 1G
```

Verification after deploy:

```bash
# Check Docker enforcing limit
docker inspect signoz-clickhouse | jq '.[0].HostConfig.Memory'
# Should show: 1073741824 (1GB)

# Check ClickHouse sees the limit
docker logs signoz-clickhouse | grep "Memory amount initially available"
# Should show: "1.00 GiB" not "3.71 GiB"

# Check actual usage
docker stats signoz-clickhouse --no-stream
```

---

## Fix 2: Ansible TLS timeout — split wait

### Problem

The Ansible `fuwa` role runs `docker compose up -d`, then waits for `curl localhost:8080/` in a 30-iteration loop (90 seconds). Then it tries TLS cert. If any container (Signoz, ClickHouse) is slow to start, the health check loop times out before reaching the TLS step. TLS only needs OpenResty on port 80 to serve the ACME challenge — it does NOT need Signoz or ClickHouse.

### Solution: Short wait for OpenResty → TLS → long wait for everything else

**Change in `infra/ansible/roles/fuwa/tasks/main.yml`**

Replace the single "Start services" + "Wait for health" block with three blocks:

```yaml
# Block 1: Start all services (returns immediately — -d flag)
- name: Start services
  ansible.builtin.shell: |
    cd /opt/fuwa/infra
    docker compose up -d --build --remove-orphans
  environment:
    PORT: "8080"

# Block 2: Wait for OpenResty only (short — just needs nginx on :80 for ACME)
- name: Wait for OpenResty (TLS)
  ansible.builtin.shell: |
    for i in $(seq 1 15); do
      curl -sf http://localhost:8080/ > /dev/null 2>&1 && exit 0
      sleep 2
    done
    exit 1
  changed_when: false
  # Total: 30 seconds max. OpenResty healthcheck start_period is 5s.

# Block 3: Obtain TLS certificate (now runs AS SOON as nginx is up)
- name: Obtain TLS certificate
  ansible.builtin.shell: |
    cd /opt/fuwa
    FUWA_DOMAIN="{{ fuwa_domain }}" FUWA_EMAIL="{{ fuwa_email }}" infra/certs.fuwa obtain
  ignore_errors: yes
  # DNS may still be propagating — retry on next deploy.cron

# Block 4: Wait for everything else (long — Signoz can take 2+ minutes)
- name: Wait for full stack health
  ansible.builtin.shell: |
    for i in $(seq 1 30); do
      docker ps --filter name=signoz --filter status=running --format '{{.Names}}' | grep -q signoz || continue
      docker ps --filter name=signoz-clickhouse --filter health=healthy --format '{{.Names}}' | grep -q clickhouse || continue
      exit 0
    done
    exit 1
  changed_when: false
  # Total: 5 minutes max (30 iterations × 10s sleep)
  # Uses liben: 10 second delay between checks
```

---

## Fix 3: Terratest public reachability test

### Problem

Terratest `http_test.go` tests `http://<droplet-ip>:8080/` — this proves Docker + firewall + nginx work, but does NOT prove the PUBLIC domain is reachable. If Cloudflare DNS is misconfigured, Cloudflare proxy blocks the port, or the domain has propagation issues, the tests all pass while real users get nothing.

### Solution: Add a public HTTP test via the domain

Add a new test function to `infra/terraform/tests/http_test.go`:

```go
func TestPublicReachable(t *testing.T) {
    t.Parallel()

    fqdn := terraform.Output(t, terraformOptions, "fqdn")

    // Test via public domain name on port 8080
    publicURL := fmt.Sprintf("http://%s:8080/", fqdn)

    client := &http.Client{Timeout: 10 * time.Second}

    var lastErr error
    for i := 0; i < 12; i++ {
        resp, err := client.Get(publicURL)
        if err == nil && resp != nil && resp.StatusCode == 200 {
            resp.Body.Close()
            return // PASS
        }
        if resp != nil {
            resp.Body.Close()
        }
        lastErr = err
        time.Sleep(15 * time.Second)
    }

    t.Fatalf("Public URL %s not reachable after 3 minutes. Last error: %v", publicURL, lastErr)
}
```

This test:
- Resolves the FQDN via public DNS (Cloudflare)
- Connects through the public internet (DO firewall → OpenResty)
- Retries for 3 minutes (DNS propagation on new droplets)
- Fails if the public domain never becomes reachable

Also update the existing `TestEndpointsReachable` to add the public domain check alongside the IP-based test:

```go
// Add to the test table in TestEndpointsReachable:
{"fuwa app (public)", fmt.Sprintf("http://%s:8080/", terraform.Output(t, terraformOptions, "fqdn")), 200},
```

---

## Apply order on the VPS

```bash
# 1. ClickHouse memory
#    Edit signoz.yml → add mem_limit: 1g
#    Revert clickhouse-config-0-0.yaml → strip bad config, keep only merge_tree safety
#    docker compose up -d signoz-clickhouse

# 2. Ansible TLS
#    Edit roles/fuwa/tasks/main.yml → split wait into 3 blocks
#    Re-run ansible-playbook bootstrap.yml

# 3. Terratest
#    Add TestPublicReachable to http_test.go
#    Run go test before considering a deploy valid
```
