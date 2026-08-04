# Fuwa Infrastructure Deployment Plan

## Memory budget — 4GB total

ClickHouse is the pig. We starve it to 2GB max and forbid automatic merges.
The math:

| Service | RAM cap | Why |
|---------|---------|-----|
| ClickHouse | 2.0 GB | `max_server_memory_usage: 2G`, merges disabled |
| SigNoz ingester (OTEL collector) | 300 MB | Batch buffer + 2 exporters |
| SigNoz Community UI | 200 MB | Golang binary + SQLite |
| Vector | 100 MB | Single source, single transform, single sink |
| VictoriaMetrics | 200 MB | 14d retention, tiny dataset |
| OpenResty | 50 MB | Lua code cache ON (prod), minimal workers |
| OS + Docker overhead | 650 MB | Ubuntu 24.04 minimal |
| **Buffer** | **500 MB** | Headroom |
| **TOTAL** | **4.0 GB** | |

## ClickHouse — starve it to 2GB, forbid merges

### Problem
ClickHouse auto-detects 90% of total RAM as `max_server_memory_usage`.
On a 4GB machine that's 3.6GB. A merge of 2,281 parts estimated 3.35GB —
10MB over the line, triggering `MEMORY_LIMIT_EXCEEDED`. The merge blocked
ALL writes to `signoz_traces`. SigNoz ingester buffered and retried,
consuming its own memory. Cascading failure.

### Fix
Three changes to `clickhouse-config-0-0.yaml`:

```yaml
# Server-level: hard cap at 2GB
max_server_memory_usage: 2147483648
max_server_memory_usage_to_ram_ratio: 0.5

# Default profile: 1GB per query max
profiles:
  default:
    allow_simdjson: 0
    load_balancing: random
    log_queries: 1
    max_memory_usage: 1000000000
    max_bytes_before_external_group_by: 500000000
    max_threads: 2

# MergeTree: forbid automatic merges
merge_tree:
  max_suspicious_broken_parts: 10000   # don't go read-only
  max_parts_in_total: 100000           # allow parts to accumulate
  parts_to_delay_insert: 2000          # slow inserts if too many parts
  parts_to_throw_insert: 5000          # reject inserts if extreme
  max_bytes_to_merge_at_max_space_in_pool: 1  # never auto-merge
  number_of_free_entries_in_pool_to_lower_max_size_of_merge: 2

# Explicitly disable background merge scheduling
background_pool_size: 1
background_merges_mutations_concurrency_ratio: 0
```

### What this means operationally
- No automatic merges ever. Parts accumulate.
- TTL drops entire partitions (15 days for traces, 3 days for usage).
- If you want to merge manually: `OPTIMIZE TABLE signoz_traces.signoz_index_v3 FINAL`
- At Fuwa's traffic volume (thousands of traces/day), parts won't reach the
  `parts_to_delay_insert` threshold before TTL cleans them.
- The 48,965 existing traces fit in just 7 active parts (3.2 MiB total).
  At this rate, you'd take months to hit any limit.

## File layout

```
.
├── terraform/
│   ├── main.tf              # providers
│   ├── variables.tf          # domain, region, tokens
│   ├── droplet.tf            # digitalocean_droplet + volume
│   ├── firewall.tf           # digitalocean_firewall
│   ├── dns.tf               # cloudflare_record
│   ├── cloudinit.yml         # boot script
│   ├── outputs.tf
│   └── tests/
│       ├── droplet_test.go   # SSH + Docker
│       ├── http_test.go      # endpoint checks
│       └── dns_test.go       # DNS resolution
│
├── ansible/
│   ├── inventory.yml         # droplet IP (from terraform output)
│   ├── playbooks/
│   │   ├── bootstrap.yml     # Install deps, clone, start
│   │   └── deploy.yml        # Pull + rebuild + redeploy
│   ├── roles/
│   │   ├── docker/           # apt-get install docker + compose
│   │   ├── fuwa/             # git clone, cert setup, cron
│   │   └── firewall/         # ufw rules
│   └── group_vars/
│       └── all.yml
│
├── deploy.fuwa                   # CI/CD deploy script
├── certs.fuwa                    # Let's Encrypt via lego
├── DEPLOYMENT.md                 # this file
├── docker-compose.yml            # main compose (uses include)
└── docker-compose/               # sub-compose files
```

## Terraform — what it provisions

### DigitalOcean
```hcl
resource "digitalocean_droplet" "fuwa" {
  image    = "ubuntu-24-04-x64"
  name     = "fuwa-prod"
  region   = "nyc3"
  size     = "s-2vcpu-4gb"        # 2 vCPU, 4GB RAM
  ssh_keys = [data.digitalocean_ssh_key.fuwa.id]
  user_data = file("cloudinit.yml")
}

resource "digitalocean_volume" "clickhouse" {
  name              = "fuwa-clickhouse"
  region            = "nyc3"
  size              = 10                # 10GB volume
  description       = "ClickHouse persistent data"
}
```

### Cloudflare
```hcl
resource "cloudflare_record" "fuwa_a" {
  zone_id = var.cloudflare_zone_id
  name    = "fuwa"
  value   = digitalocean_droplet.fuwa.ipv4_address
  type    = "A"
  proxied = false   # false until TLS is confirmed working
}

resource "cloudflare_record" "fuwa_wildcard" {
  zone_id = var.cloudflare_zone_id
  name    = "*.fuwa"
  value   = digitalocean_droplet.fuwa.ipv4_address
  type    = "A"
  proxied = false
}
```

### Firewall
```hcl
resource "digitalocean_firewall" "fuwa" {
  name = "fuwa-fw"
  droplet_ids = [digitalocean_droplet.fuwa.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0"]   # SSH — restrict to your IP in prod
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0"]   # HTTP (Let's Encrypt)
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0"]   # HTTPS
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "8080"
    source_addresses = ["0.0.0.0/0"]   # OpenResty (or ${PORT})

  # Block everything else — ClickHouse, SigNoz, Vector ports are internal only
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0"]
  }
}
```

## Ansible — what it does after Terraform

### bootstrap.yml
```yaml
- hosts: fuwa
  become: yes
  vars:
    fuwa_branch: "ui-redesign-sqlite-implementation-infra-merge"
    fuwa_domain: "{{ lookup('env', 'FUWA_DOMAIN') }}"
    fuwa_email:  "{{ lookup('env', 'FUWA_EMAIL') }}"

  tasks:
    - name: Install Docker + Compose
      ansible.builtin.shell: curl -fsSL https://get.docker.com | sh
      args:
        creates: /usr/bin/docker

    - name: Enable Docker
      ansible.builtin.systemd: name=docker enabled=yes state=started

    - name: Clone fuwa
      ansible.builtin.git:
        repo: https://github.com/Schywi/fuwa.git
        dest: /opt/fuwa
        version: "{{ fuwa_branch }}"
        force: yes

    - name: Mount ClickHouse volume
      ansible.builtin.shell: |
        mkdir -p /mnt/clickhouse
        if ! mountpoint -q /mnt/clickhouse; then
          mkfs.ext4 -F /dev/disk/by-id/scsi-0DO_Volume_* 2>/dev/null || true
          mount /dev/disk/by-id/scsi-0DO_Volume_* /mnt/clickhouse
        fi

    - name: Create systemd override for ClickHouse volume
      ansible.builtin.copy:
        dest: /etc/systemd/system/docker-compose-fuwa.service.d/volume.conf
        content: |
          [Service]
          ExecStartPre=/bin/mountpoint -q /mnt/clickhouse || exit 1

    - name: Start services
      ansible.builtin.shell: |
        cd /opt/fuwa/infra
        docker compose up -d
      environment:
        PORT: "8080"
        FUWA_DOMAIN: "{{ fuwa_domain }}"
        FUWA_EMAIL: "{{ fuwa_email }}"

    - name: Obtain TLS cert
      ansible.builtin.shell: |
        cd /opt/fuwa
        FUWA_DOMAIN="{{ fuwa_domain }}" FUWA_EMAIL="{{ fuwa_email }}" infra/certs.fuwa obtain
      ignore_errors: yes   # will retry on next deploy if DNS hasn't propagated

    - name: Setup deploy cron
      ansible.builtin.cron:
        name: "fuwa-deploy"
        minute: "*/5"
        job: "cd /opt/fuwa && infra/deploy.fuwa deploy >> /var/log/fuwa-deploy.log 2>&1"

    - name: Setup cert renewal cron
      ansible.builtin.cron:
        name: "fuwa-certs"
        minute: "0"
        hour: "3"
        job: "cd /opt/fuwa && FUWA_DOMAIN='{{ fuwa_domain }}' FUWA_EMAIL='{{ fuwa_email }}' infra/certs.fuwa renew >> /var/log/fuwa-certs.log 2>&1"
```

### deploy.yml (what the cron runs)
```yaml
- hosts: fuwa
  become: yes
  tasks:
    - name: Pull latest
      ansible.builtin.git:
        repo: https://github.com/Schywi/fuwa.git
        dest: /opt/fuwa
        version: "{{ fuwa_branch }}"
        force: yes

    - name: Rebuild and redeploy
      ansible.builtin.shell: |
        cd /opt/fuwa/infra
        docker compose up -d --build --remove-orphans

    - name: Reload OpenResty if certs changed
      ansible.builtin.shell: |
        cd /opt/fuwa/infra
        docker compose exec -T openresty nginx -s reload 2>/dev/null || true
```

## Terratest — what it verifies

### droplet_test.go
```go
func TestDropletHealthy(t *testing.T) {
    t.Parallel()

    // SSH connection works
    host := ssh.Host{
        Hostname:    terraform.Output(t, options, "droplet_ip"),
        SshUser:     "root",
        SshKeyPair:  keyPair,
    }

    // Docker daemon running
    output := ssh.CheckSshCommand(t, host, "docker ps --format '{{.Names}}'")
    assert.Contains(t, output, "openresty")
    assert.Contains(t, output, "signoz-ingester")
    assert.Contains(t, output, "signoz-clickhouse")

    // ClickHouse memory under 2GB cap
    mem := ssh.CheckSshCommand(t, host,
        "docker stats --no-stream --format '{{.MemUsage}}' $(docker ps -q -f name=signoz-clickhouse)")
    // parse and assert < 2.1 GB
}
```

### http_test.go
```go
func TestEndpoints(t *testing.T) {
    t.Parallel()

    domain := terraform.Output(t, options, "fuwa_domain")
    base := fmt.Sprintf("http://%s:8080", domain)

    tests := []struct{
        endpoint string
        wantStatus int
    }{
        {"/", 200},
        {"/dash/signoz/", 302},
        {"/dash/vmetrics/", 200},
        {"/__dev/traces", 200},
    }

    for _, tt := range tests {
        t.Run(tt.endpoint, func(t *testing.T) {
            resp, _ := http.Get(base + tt.endpoint)
            assert.Equal(t, tt.wantStatus, resp.StatusCode)
        })
    }
}
```

### dns_test.go
```go
func TestDNSPropagated(t *testing.T) {
    t.Parallel()

    expectedIP := terraform.Output(t, options, "droplet_ip")
    domain := terraform.Output(t, options, "fuwa_domain")

    ips, _ := net.LookupHost("fuwa." + domain)
    assert.Contains(t, ips, expectedIP)
}
```

## Deployment order

```
1. terraform apply     → droplet + volume + DNS + firewall
2. Wait 30s for boot
3. ansible-playbook bootstrap.yml   → Docker + clone + start + certs
4. go test ./tests/terraform/...     → verify everything
5. Push code to GitHub               → cron auto-deploys within 5 min
```

## What we refuse to do

- No Coolify. OpenResty is the proxy.
- No Traefik/Caddy sidecar. OpenResty terminates TLS directly.
- No ClickHouse merges. Parts accumulate → TTL drops them.
- No more than 4GB RAM. ClickHouse starved to 2GB, others fit in 1.5GB, 500MB buffer.
- No Kubernetes. Docker Compose on a single droplet.
