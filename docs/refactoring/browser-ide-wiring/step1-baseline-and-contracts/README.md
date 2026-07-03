# Step 1: Baseline And Contracts

Goal: lock the current working shell/tenant flow as the compatibility baseline
before introducing the browser worker substrate.

Why this step exists:

- the route-backed shell proof is already working
- later Wasmoon work must not regress it accidentally
- the public README still describes a worker architecture that is ahead of the
  current implementation

Current baseline in code:

- shell root routing:
  [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:860)
- payload routing:
  [runtime/fuwa-dev.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua:294)
- shell payload mount seam:
  [runtime/host/capabilities.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua:133)
- shell dashboard model:
  [runtime/host/dashboard.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/dashboard.lua:140)
- shell fragment renderer:
  [runtime/host/shell_views.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/shell_views.lua:46)

Deliverables:

1. Define the stable host contract.
   - `host.mount_payload(slot, payload_id)` remains the only required mount
     verb during the substrate swap
   - shell views consume returned mount HTML or a mount descriptor
   - payloads never import or resolve host modules

2. Define the stable tenant document contract.
   - every tenant has a routable full document at `/payload/:id/`
   - tenant HTMX routes are absolute and tenant-scoped
   - tenant browser glue lives beside the payload, not in the shell

3. Define the stable shell render contract.
   - full document responses use shell layouts
   - HTMX shell actions use fragment templates only
   - no conditional `include` tricks come back

4. Freeze regression tests before larger changes.
   Keep and extend:
   - [tests/dev_server_smoke.lua](/mnt/DATA/development/projects/repos/fuwa/tests/dev_server_smoke.lua:1)
   - [tests/acceptance/shell_host.lua](/mnt/DATA/development/projects/repos/fuwa/tests/acceptance/shell_host.lua:1)
   - [tests/acceptance/current_payload.lua](/mnt/DATA/development/projects/repos/fuwa/tests/acceptance/current_payload.lua:1)

5. Document the gap between current implementation and browser target.
   This is not a code change requirement here. It is a planning guard:
   - current implementation = route-backed server Lua runtime
   - next target = browser worker runtime behind the same shell seam

Acceptance criteria:

- shell route, payload route, and shell fragment tests stay green
- every future runtime change can be checked against this baseline
- the team has one explicit answer to "what must not change while Wasmoon is
  being introduced?"

ASCII:

```text
NOW = BASELINE

GET /
  -> shell document
  -> host.mount_payload("preview", "current")
  -> iframe src="/payload/current/"

GET /payload/current/
  -> tenant full document
  -> htmx posts to /payload/current/...

POST /switch/:id
  -> shell fragment only
```
