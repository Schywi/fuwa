## Uptrace No-Typing Access Plan

Date: 2026-07-23

## Goal

When we open the local Uptrace dashboard, we should land inside the dashboard
without typing email/password into the login form.

This plan is intentionally narrow:

- keep Uptrace authentication intact
- remove manual credential entry in local/dev access
- avoid inventing a fake anonymous mode that current upstream does not document
- keep the solution inside `infra/`

## Code Truth and Research Boundary

Current upstream Uptrace, as verified on 2026-07-23:

- the public cloud demo at `app.uptrace.dev/play` is advertised as "no login
  required"
- the self-hosted Docker example still tells the operator to log in with a
  seeded user
- the shipped config examples expose seeded users and `auth.disabled`, but no
  verified `auth.auto_login` setting
- the backend login flow is a normal credential POST to
  `/internal/v1/users/login`, which sets an auth cookie

This means we should not plan around an undocumented self-hosted
"anonymous dashboard" switch unless we verify it in source first.

## Desired Local UX

Target behavior:

1. We visit the local Uptrace entry URL.
2. A helper route performs the login request automatically with seeded dev
   credentials.
3. Uptrace sets its normal session cookie.
4. The browser is redirected into the dashboard.
5. Subsequent visits reuse the existing session and do not show the login form.

The important distinction is:

- no manual typing
- no disabled auth
- no custom dashboard replacement

## Chosen Shape

Use a small infra-owned access shim in front of Uptrace.

That shim should live in the OpenResty layer under `infra/`, not inside `fuwa`
runtime code.

Why this shape:

- it keeps the behavior infra-local
- it matches the existing prod-shaped edge direction already present in this repo
- it does not require changing Uptrace source or image internals
- it uses the same login endpoint the product already supports

## Required Infra Pieces

### 1. A real Uptrace config file

Current blocker:

- the current `uptrace` service restarts because `/etc/uptrace/config.yml` is
  missing

Needed:

- add `infra/docker-compose/uptrace/config.yml`
- mount it into the `uptrace` container as `/etc/uptrace/config.yml`

The config must define:

- a stable `secret_key`
- PostgreSQL connection
- ClickHouse connection
- one seeded dev user
- one seeded org/project if needed for immediate dashboard entry

### 2. A PostgreSQL service

Current upstream Uptrace uses:

- ClickHouse for telemetry storage
- PostgreSQL for metadata such as users, projects, alerts, and other app state

Needed:

- add a PostgreSQL service in the observability stack for Uptrace
- wire Uptrace to that database in `config.yml`

Without PostgreSQL, even a working login bypass is the wrong target because the
app itself is incomplete.

### 3. A seeded dev user

The config should create one known local user, for example:

- email: `admin@uptrace.local`
- password: `admin`

The exact values are not important. What matters is:

- they are deterministic in local/dev
- the access shim knows them
- they are not presented for manual typing

## Access Shim Plan

### Route Contract

Define one OpenResty-owned route for local/dev access, for example:

- `/uptrace-local/`

Behavior:

1. Check whether the browser already has a valid Uptrace session cookie.
2. If session exists, redirect straight to the dashboard route.
3. If session does not exist:
   - POST to Uptrace login endpoint with the seeded dev credentials
   - capture the returned `Set-Cookie`
   - forward that cookie to the browser
   - redirect into the dashboard

This route is the only entrypoint humans need.

### Dashboard Redirect Target

Use one deterministic landing path after login, for example:

- `/projects/<id>/tracing`
- or the current root dashboard path if Uptrace redirects there naturally

The exact path should be chosen after one live self-hosted run confirms the
current route structure for the installed version.

### Cookie Handling

The shim must preserve Uptrace's own auth model rather than inventing a parallel
session layer.

That means:

- let Uptrace mint the session cookie
- forward the cookie back to the browser
- avoid storing passwords in browser code
- keep credentials server-side in the infra route only

## File Plan

Planned files under `infra/`:

- `infra/docker-compose/uptrace/config.yml`
- `infra/docker-compose/uptrace/init.sql` if PostgreSQL bootstrap is needed
- `infra/docker-compose/observability.yml` updates for:
  - `postgres`
  - `uptrace` volume mount
  - `uptrace` env alignment
- `infra/openresty/dev/` or `infra/openresty/prod/` route additions for:
  - local Uptrace auto-login entrypoint
  - proxying to Uptrace backend

If we want a strict environment split, use:

- `infra/openresty/dev/` for the no-typing helper
- `infra/openresty/prod/` only if we also want the same behavior on a VPS

## Environment Split

### Dev-only behavior

The automatic local login path belongs in dev-first infrastructure.

Reason:

- it optimizes operator convenience
- it intentionally hides credentials from the local workflow
- it uses generic seeded dev credentials

This is appropriate for:

- local Docker Compose
- local Tilt-driven access

### Prod decision

For VPS/prod-shaped deployment, we need an explicit choice:

- keep the helper and accept auto-login convenience in a protected environment
- or require normal Uptrace login there

This plan does not assume prod should auto-login. It only makes the dev path
concrete first.

## Implementation Steps

### Phase 1. Make Uptrace actually boot

1. Add a checked-in Uptrace config file under `infra/docker-compose/uptrace/`.
2. Add PostgreSQL to the observability stack.
3. Mount `config.yml` into the `uptrace` container.
4. Confirm `uptrace` stops restarting.
5. Confirm the login page loads from self-hosted Uptrace.

Success condition:

- `docker compose ... ps` shows `uptrace` healthy and stable
- the dashboard UI is reachable at the configured port

### Phase 2. Seed deterministic local credentials

1. Add one seeded admin user to Uptrace config.
2. Add seed org/project data if the first screen needs it.
3. Verify manual login works once with the seeded account.

Success condition:

- manual login succeeds with the known dev credentials

### Phase 3. Add the no-typing entry route

1. Add one OpenResty helper route under `infra/openresty/...`.
2. Have it POST to `/internal/v1/users/login`.
3. Capture and forward the returned auth cookie.
4. Redirect into the dashboard path.
5. Preserve a direct upstream proxy path to the underlying Uptrace app.

Success condition:

- visiting the helper URL lands inside the dashboard without showing the login
  form

### Phase 4. Verify repeat access

1. Open the helper URL in a clean browser session.
2. Confirm first visit logs in automatically.
3. Refresh the dashboard.
4. Confirm the session persists.
5. Clear cookies and repeat.

Success condition:

- no manual credential entry is required in the normal local flow

## Validation Checklist

- `uptrace` container no longer restarts
- PostgreSQL and ClickHouse are both reachable by Uptrace
- self-hosted Uptrace login works manually before the helper is introduced
- helper route lands inside the dashboard
- helper route does not expose raw credentials in browser-visible JS
- helper route still works after container restart
- helper route still works through the chosen OpenResty front door

## Risks and Boundaries

### Risk 1. Uptrace route shape may differ by version

The post-login landing path may vary. We should verify the exact redirect target
against the version we actually run.

### Risk 2. CSRF or cookie flags may require proxy alignment

If Uptrace expects host/scheme/cookie attributes to match, the helper route may
need to proxy through the same external origin rather than calling a raw port
directly.

### Risk 3. Dev convenience is not the same as anonymous access

This plan removes typing, not authentication. That distinction should remain
explicit in docs and config.

## Non-Goals

Out of scope for this plan:

- patching Uptrace source
- building a custom dashboard UI
- replacing Uptrace auth with a fake guest mode
- exposing Vector/VictoriaMetrics/ClickHouse UIs publicly
- changing `fuwa` application runtime code

## Decision Summary

The shortest credible path is:

1. finish self-hosted Uptrace properly
2. seed deterministic local credentials
3. add an infra-owned auto-login entry route

That gets us the outcome we actually want:

- open the local dashboard
- land inside it
- no manual login typing

