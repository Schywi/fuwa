# Infra CI/CD — Terraform + Ansible + Terratest gate
#
# You are adding a GitHub Actions workflow that runs on every push to main.
# It provisions real DO infrastructure, runs Ansible, validates with Terratest,
# and destroys everything. If it fails, the push is blocked.
#
# ⚠️ CRITICAL: The workflow MUST run Ansible between terraform apply and terratest.
# Without Ansible, the droplet is bare — no Docker, no OpenResty, no services.
# Terratest hits http://<ip>:8080/ and gets "connection refused" every time.
#
# Correct order:
#   1. tfsec (security)
#   2. terraform init → validate → apply (droplet + DNS)
#   3. SSH key setup (write private key, add known_hosts)
#   4. ansible-playbook bootstrap.yml (install Docker, start services)
#   5. ansible-playbook verify.yml (health check, trace flow) — OPTIONAL but recommended
#   6. go test (Terratest: DNS, HTTP, droplet health)
#   7. terraform destroy (ALWAYS, even if tests fail)
#
# This is a handoff document. Another agent should implement the files below.

## Secrets needed in GitHub repo (Settings → Secrets → Actions)

| Secret name | Where to get it |
|-------------|----------------|
| `DIGITALOCEAN_TOKEN` | https://cloud.digitalocean.com/account/api/tokens → Generate New Token (write scope) |
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/profile/api-tokens → Create Token → Zone.DNS:Edit, scoped to your zone |
| `TF_VAR_cf_zone_id` | Cloudflare dashboard → Overview sidebar → Zone ID |
| `TF_VAR_domain` | Your base domain, e.g. `example.com` |
| `SSH_PRIVATE_KEY` | Content of `~/.ssh/id_ed25519` (ENTIRE file including BEGIN/END lines) |
| `TF_VAR_fuwa_email` | Email for Let's Encrypt certificate (can be anything for CI, e.g. `ci@example.com`) |

## Step 1: Add infra-test.yml workflow

Create `.github/workflows/infra-test.yml`:

```yaml
name: infra-test

on:
  workflow_call:   # makes it callable from build.yml

env:
  TF_VAR_do_token: ${{ secrets.DIGITALOCEAN_TOKEN }}
  TF_VAR_cf_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  TF_VAR_cf_zone_id: ${{ secrets.TF_VAR_cf_zone_id }}
  TF_VAR_domain: ${{ secrets.TF_VAR_domain }}
  TF_VAR_subdomain: ci-test
  TF_VAR_fuwa_branch: ${{ github.ref_name }}
  FUWA_HOST: ""   # filled by terraform output step

jobs:
  infra:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra/terraform

    steps:
      - uses: actions/checkout@v4

      # ── Security: static analysis on Terraform ──────────────────
      - name: tfsec
        uses: aquasecurity/tfsec-action@v1
        with:
          working_directory: infra/terraform

      # ── Terraform init + validate ──────────────────────────────
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.9"

      - name: Terraform init
        run: terraform init

      - name: Terraform validate
        run: terraform validate

      # ── Terraform apply (provision droplet + DNS) ──────────────
      - name: Terraform apply
        run: terraform apply -auto-approve

      - name: Export droplet IP
        id: ip
        run: echo "FUWA_HOST=$(terraform output -raw droplet_ip)" >> $GITHUB_ENV

      # ── SSH key setup for Ansible ─────────────────────────────
      - name: Setup SSH key
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan -H $FUWA_HOST >> ~/.ssh/known_hosts

      # ── Ansible ───────────────────────────────────────────────
      - name: Install Ansible
        run: pip install ansible

      - name: Run bootstrap
        working-directory: infra/ansible
        env:
          FUWA_DOMAIN: ${{ secrets.TF_VAR_domain }}
          FUWA_EMAIL: ${{ secrets.TF_VAR_fuwa_email }}
        run: |
          echo "$FUWA_HOST" > /tmp/inventory.yml
          # Use inline inventory with the ephemeral droplet IP
          ansible-playbook -i <(echo "fuwa ansible_host=$FUWA_HOST ansible_user=root") playbooks/bootstrap.yml

      # ── Terratest ──────────────────────────────────────────────
      - uses: actions/setup-go@v5
        with:
          go-version: "1.23"

      - name: Run Terratest
        working-directory: infra/terraform/tests
        env:
          FUWA_HOST: ${{ env.FUWA_HOST }}
        run: |
          go mod init fuwa-terratest 2>/dev/null || true
          go mod tidy
          go test -v -timeout 15m -count=1 ./...

      # ── Destroy (always, even if tests fail) ───────────────────
      - name: Terraform destroy
        if: always()
        run: terraform destroy -auto-approve
```

Key details:
- `on: workflow_call` — this workflow is NOT triggered by push directly. It's called by build.yml.
- `if: always()` on destroy — the droplet gets destroyed even if Terratest fails. No leaked infrastructure.
- `TF_VAR_subdomain: ci-test` — creates `ci-test.example.com` so it never collides with the real `fuwa.example.com`.
- `TF_VAR_fuwa_branch: ${{ github.ref_name }}` — the pushed branch gets deployed on the ephemeral droplet. Ansible bootstraps from THAT branch, so you test the actual code being pushed.
- `tfsec` runs FIRST — catches hardcoded secrets, overly permissive firewall rules, missing encryption BEFORE spending money on a droplet.

## Step 2: Wire infra-test into build.yml

Edit `.github/workflows/build.yml`. Add this job at the end:

```yaml
  infra-gate:
    needs: docker
    uses: ./.github/workflows/infra-test.yml
    secrets: inherit
```

Full build.yml after change:

```yaml
name: build

on:
  push:
    branches: [main]

concurrency:
  group: build-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lua syntax check
        run: make compile-check
      - name: Unit tests (Lua)
        run: make test-unit

  docker:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build OpenResty image
        run: docker build -t fuwa-openresty -f infra/Dockerfile.openresty .

  infra-gate:
    needs: docker
    uses: ./.github/workflows/infra-test.yml
    secrets: inherit
```

The flow:

```
push to main
  ├── test (compile-check + unit tests)
  └── docker (build OpenResty image)
        └── infra-gate (terraform apply → terratest → destroy)
```

If `infra-gate` fails, the entire push is marked as failed. The droplet gets destroyed regardless. No code reaches the production droplet's deploy.fuwa cron until the gate passes.

## Step 3: Terratest consolidation (critical fix)

Current Terratest files each do their own `terraform.InitAndApply`. This means each test provisions its OWN droplet. Three test files = three droplets = three times the cost and three times the wait.

Fix: consolidate into a single test setup. The simplest approach — add a `TestMain` in `helper_test.go`:

```go
package test

import (
    "os"
    "testing"
    "github.com/gruntwork-io/terratest/modules/terraform"
)

var terraformOptions *terraform.Options

func TestMain(m *testing.M) {
    terraformOptions = &terraform.Options{
        TerraformDir: "../",
        Vars: map[string]interface{}{
            "subdomain": "ci-test",
        },
    }

    terraform.InitAndApply(nil, terraformOptions)

    code := m.Run()

    terraform.Destroy(nil, terraformOptions)
    os.Exit(code)
}
```

Then each test file uses the shared `terraformOptions` instead of creating its own. Remove individual `InitAndApply` + `defer Destroy` from each file.

## Step 4: DNS retry in Terratest

The `dns_test.go` does `net.LookupHost(fqdn)` immediately — no retry. Cloudflare DNS with TTL=1 can still take a few seconds. Add retry:

```go
func TestDNSPropagated(t *testing.T) {
    fqdn := terraform.Output(t, terraformOptions, "fqdn")
    ip := terraform.Output(t, terraformOptions, "droplet_ip")

    var resolved []string
    for i := 0; i < 12; i++ {
        resolved, _ = net.LookupHost(fqdn)
        for _, addr := range resolved {
            if addr == ip {
                return
            }
        }
        time.Sleep(10 * time.Second)
    }
    t.Fatalf("DNS for %s did not resolve to %s after 2 minutes: got %v", fqdn, ip, resolved)
}
```

## Step 5: Verification checklist

After implementing, push a test commit and check:

- [ ] `tfsec` passes (no security issues flagged)
- [ ] `terraform validate` passes
- [ ] `terraform apply` creates droplet + DNS records
- [ ] Ansible bootstrap completes (all containers healthy)
- [ ] Terratest `dns_test.go` passes (DNS resolves to droplet)
- [ ] Terratest `http_test.go` passes (all 7 endpoints respond)
- [ ] Terratest `droplet_test.go` passes (Docker + containers + CH memory)
- [ ] `terraform destroy` runs even if tests fail
- [ ] DO dashboard shows no leaked droplets after workflow completes
- [ ] Cloudflare dashboard shows no leftover `ci-test` DNS records

## Cost estimate

Droplet `s-2vcpu-4gb`: $0.048/hour. At ~8 minutes per workflow run (apply + ansible + test + destroy), that's ~$0.006 per push. At 100 pushes per month: $0.64.
