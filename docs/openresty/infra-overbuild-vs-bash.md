# Infra Overbuild vs Bash

This note answers one question:

> Did we overbuild the infra side, and would a simple bash script have been enough?

## Short answer

For the specific concern of **local resume/dev orchestration**, yes, a lot of the
infrastructure shape can be simpler than a full declarative stack.

For the broader concerns of:

- repeatable DNS/TLS/VPS provisioning
- multi-domain routing
- persistent origin config
- team handoff
- rebuilds after machine loss

pure bash becomes weaker quickly.

## What the checked repo actually shows

In the checked `fuwa-infra-exploration` tree, there are:

- shell scripts
- docker-compose files
- docs about Signoz, OpenResty, Tilt, and next steps

There are **no checked Terraform files** in the repo root or near-root tree that
I inspected.

So the first important correction is:

- I cannot confirm a real checked-in Terraform implementation from that repo
  because there are no `.tf` files in the inspected tree.

What I *can* confirm is that the docs in that repo already lean toward a simpler
local orchestration stance.

## Evidence from `fuwa-infra-exploration`

The clearest statement is in:

- [/mnt/DATA/development/projects/repos/fuwa-infra-exploration/docs/infra/fuwa-infra-next-steps.md](/mnt/DATA/development/projects/repos/fuwa-infra-exploration/docs/infra/fuwa-infra-next-steps.md:230)

That doc explicitly says:

- `docker compose` plus `./dev.sh` may be enough
- `Tiltfile` is optional dev orchestration
- `Tiltfile` should be treated as optional, not core telemetry work

So even that exploration repo was already arguing for a smaller first step.

## Practical judgment

If your real goal is only:

- bring the stack up locally
- resume work quickly
- restart services
- tail logs
- maybe seed a few configs

then yes, a simple bash entrypoint plus `docker compose` is usually enough.

Example scope where bash is enough:

- `./dev.sh up`
- `./dev.sh down`
- `./dev.sh logs openresty`
- `./dev.sh restart openresty`
- `./dev.sh seed`

That is a good fit for:

- one developer
- one VPS
- low ceremony
- local resume speed

## When bash stops being enough

Terraform or another declarative infra tool starts making sense when you need:

- reproducible VPS creation
- DNS records managed as code
- load balancer / firewall / networking state as code
- certificates/origin config managed repeatably
- multiple environments
- auditable infra changes
- safe teardown/rebuild without tribal knowledge

In other words:

- **local process orchestration** -> bash is fine
- **real infrastructure lifecycle** -> bash becomes fragile

## The real overbuild risk here

The overbuild risk is not "Terraform exists".

The overbuild risk is mixing together:

- app runtime decisions
- local dev orchestration
- observability stack setup
- VPS/domain provisioning

into one giant "infra" project too early.

That is what creates blast radius.

## Recommendation

Use the smallest tool for each layer:

### 1. Local resume/dev

Use:

- `dev.sh`
- `docker compose`
- maybe a small helper script for logs/restarts/seeding

This is where bash wins.

### 2. App runtime

Keep in-repo runtime logic here:

- OpenResty routes
- deploy/public preview flow
- browser/runtime split

This is application architecture, not VPS provisioning.

### 3. Real infra lifecycle

Only introduce Terraform if you actually want to manage:

- domains
- VPS instances
- DNS records
- firewalls
- certificates/origin topology

as code.

If the only ask is "make resume easy", Terraform is too much.

## Bottom line

Based on the checked `fuwa-infra-exploration` tree:

- yes, the local orchestration side was already pointing toward simpler
  `dev.sh` + Compose usage
- no, I cannot confirm a real checked Terraform solution there because no
  Terraform files were present in the inspected repo tree
- yes, for **resume-only** workflows, bash would almost certainly be enough
- no, bash is not a replacement for real infrastructure-as-code once domain/VPS
  provisioning and repeatability become first-class requirements
