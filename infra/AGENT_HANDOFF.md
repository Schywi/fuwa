# Terraform + Ansible + Terratest — agent handoff

You are provisioning the fuwa stack on a fresh DigitalOcean droplet. Work
through each section in order. Do not skip verification steps.

## Prerequisites (obtain from the user before starting)

- `DIGITALOCEAN_TOKEN` — from https://cloud.digitalocean.com/account/api/tokens (write scope)
- `CLOUDFLARE_API_TOKEN` — from https://dash.cloudflare.com/profile/api-tokens (Zone.DNS Edit, scoped to the target zone)
- `TF_VAR_cf_zone_id` — Cloudflare Zone ID (found in Overview sidebar)
- `TF_VAR_domain` — e.g. `example.com`
- SSH key pair: public key uploaded to DO dashboard (name it `fuwa`), private key available at `~/.ssh/id_ed25519`

## Files you will work with

```
infra/
├── terraform/             # DO droplet + Cloudflare DNS
├── ansible/               # post-boot configuration
├── deploy.fuwa            # CI/CD cron script
├── certs.fuwa             # Let's Encrypt via lego
├── docker-compose.yml     # main compose entry
└── docker-compose/        # sub-compose files
```

## Phase 1 — Terraform

```
cd infra/terraform
```

1. Copy the vars template:
   ```
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Edit `terraform.tfvars` — fill in the five values from Prerequisites above.

3. Init and apply:
   ```
   terraform init
   terraform plan
   terraform apply
   ```

4. Record the outputs. You will need them:
   ```
   export FUWA_HOST=$(terraform output -raw droplet_ip)
   export FUWA_DOMAIN=$(terraform output -raw fqdn)
   ```

  Terraform provisions:
   - 1 droplet (s-2vcpu-4gb, Ubuntu 24.04, nyc3)
   - DO firewall (22, 80, 443, 8080 open)
   - Cloudflare A + wildcard records for fuwa.<domain>
   - cloud-init: installs Docker, Docker Compose plugin, configures ufw, clones repo to /opt/fuwa

   The cloud-init does NOT start the services — Ansible handles that.

## Phase 2 — Wait for cloud-init

The droplet takes ~2 minutes to finish cloud-init. Verify:

```
ssh root@$FUWA_HOST 'docker ps && ls /opt/fuwa/infra/docker-compose.yml'
```

Both commands must succeed before proceeding.

## Phase 3 — Ansible

```
cd infra/ansible
```

1. Verify the inventory resolves:
   ```
   ansible-inventory -i inventory.yml --list
   ```

2. Run the bootstrap:
   ```
   export FUWA_HOST=<from terraform output>
   export FUWA_DOMAIN=<from terraform output>
   export FUWA_EMAIL=<user's email>

   ansible-playbook -i inventory.yml playbooks/bootstrap.yml
   ```

   The playbook:
   - Ensures Docker is running
   - Configures ufw firewall
   - Checks out the correct branch
   - Verifies Docker Compose is available
   - Starts all services via `docker compose up -d`
   - Verifies the include-based compose file resolves services
   - Waits for OpenResty health check
   - Obtains TLS certificate via infra/certs.fuwa
   - Sets up deploy cron (every 5 min) and cert renewal cron (daily)

3. Verify services are up:
   ```
   ssh root@$FUWA_HOST 'docker ps --format "table {{.Names}}\t{{.Status}}"'
   ```

   Expected running containers:
   - openresty (healthy)
   - vector-router, victoriametrics
   - signoz, signoz-ingester, signoz-clickhouse, signoz-keeper
   - signoz-bootstrap (exited 0)
   - signoz-migrator (exited 0)
   - loadtest-traces, loadtest-fuwa
   - k6-* (4 containers, will exit after test duration)

## Phase 4 — Verify endpoints

From your local machine (not SSH):

```
IP=<droplet-ip>

# Fuwa app
curl -s -o /dev/null -w "%{http_code}" http://$IP:8080/
# Expected: 200

# SigNoz dashboard
curl -s -o /dev/null -w "%{http_code}" http://$IP:8080/dash/signoz/
# Expected: 302

# VictoriaMetrics
curl -s -o /dev/null -w "%{http_code}" http://$IP:8080/dash/vmetrics/
# Expected: 200

# ClickHouse UI
curl -s -o /dev/null -w "%{http_code}" http://$IP:8080/dash/clickhouse/
# Expected: 200
```

## Phase 5 — Verify observability data

Wait 2 minutes for the loadtest to generate trace/log/metric data, then:

```
# Check traces in ClickHouse (should be > 0)
ssh root@$FUWA_HOST 'docker compose -f /opt/fuwa/infra/docker-compose.yml exec -T signoz-clickhouse clickhouse-client --query "SELECT count() FROM signoz_traces.distributed_signoz_index_v2"'

# Check that ClickHouse memory is under 2 GB
ssh root@$FUWA_HOST 'docker stats --no-stream --format "{{.MemUsage}}" $(docker ps -q -f name=signoz-clickhouse)'
```

Open `http://$IP:8080/dash/signoz/` in a browser. Navigate to Services → you should see both `fuwa` and `loadtest` services with trace data.

## Phase 6 — Terratest (Go required locally)

From the repo root:

```
cd infra/terraform/tests
go test ./...
go test -v -run TestDNSPropagated
go test -v -run TestEndpointsReachable
```

Each test provisions and destroys its own stack. Run them one by one; they are not designed for parallel execution.

## Troubleshooting

**ClickHouse OOM:** If `docker logs signoz-clickhouse` shows `MEMORY_LIMIT_EXCEEDED`:
```
ssh root@$FUWA_HOST 'docker compose -f /opt/fuwa/infra/docker-compose.yml exec -T signoz-clickhouse clickhouse-client --query "SYSTEM STOP MERGES"'
```

**No traces in Signoz:** Check the distributed table:
```
ssh root@$FUWA_HOST 'docker compose -f /opt/fuwa/infra/docker-compose.yml exec -T signoz-clickhouse clickhouse-client --query "SELECT count() FROM signoz_traces.signoz_index_v3"'
```
If data is in `signoz_index_v3` but not `distributed_signoz_index_v2`, the distributed table may point to the wrong underlying table. The bootstrap playbook should handle this, but manual fix:
```
DROP TABLE IF EXISTS signoz_traces.distributed_signoz_index_v2;
CREATE TABLE signoz_traces.distributed_signoz_index_v2 AS signoz_traces.signoz_index_v3 ENGINE = Distributed('cluster', 'signoz_traces', 'signoz_index_v3', cityHash64(trace_id));
```

**TLS cert not obtained:** DNS propagation can take minutes. Retry manually:
```
ssh root@$FUWA_HOST 'cd /opt/fuwa && FUWA_DOMAIN=<domain> FUWA_EMAIL=<email> infra/certs.fuwa obtain'
```
