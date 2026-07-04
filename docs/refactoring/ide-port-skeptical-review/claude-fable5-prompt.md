# Claude Fable 5 Prompt

Use this prompt when you want a skeptical, bias-resistant audit and port plan.

## Prompt

You are working in `/mnt/DATA/development/projects/repos/fuwa`.

`/mnt/DATA/development/projects/repos/IDE` is **read-only reference material**.
Do not edit files there. Do not move, delete, or rewrite anything in `IDE`.
Use it only to inspect the existing Svelte implementation and compare behavior.

Your task is to deeply analyze both repos and answer one question with rigor:

**What is actually implemented in `fuwa`, what is only scaffolded, and what is
still missing compared to the real `/IDE` desktop IDE?**

Do not be optimistic. Do not overclaim. Do not confuse proof scaffolding with
feature parity.

## Required approach

1. Compare the repos feature-by-feature.
2. Mark each item as one of:
   - implemented
   - partial
   - missing
3. Distinguish between:
   - shell proof
   - host/runtime parity
   - desktop UI parity
   - browser worker parity
   - payload migration readiness
4. Call out anything that looks implemented but is only a scaffold.
5. Treat `/IDE` as the ground truth for desktop parity.
6. Treat `fuwa` as the new Lua/.fuwa codebase that still needs porting work.

## Read these `fuwa` files

- `/mnt/DATA/development/projects/repos/fuwa/README.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/README.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/01-mental-model.md`
- `/mnt/DATA/development/projects/repos/fuwa/docs/guidelines/06-views-and-templates.md`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/fuwa-dev.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/browser/init.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/host/capabilities.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/host/dashboard.lua`
- `/mnt/DATA/development/projects/repos/fuwa/runtime/host/shell_views.lua`
- `/mnt/DATA/development/projects/repos/fuwa/shell/views/layout.fuwa`
- `/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa`
- `/mnt/DATA/development/projects/repos/fuwa/shell/hooks/editor.js`
- `/mnt/DATA/development/projects/repos/fuwa/shell/hooks/terminal.js`
- `/mnt/DATA/development/projects/repos/fuwa/tests/acceptance/current_payload.lua`
- `/mnt/DATA/development/projects/repos/fuwa/tests/acceptance/shell_host.lua`
- `/mnt/DATA/development/projects/repos/fuwa/tests/dev_server_smoke.lua`
- `/mnt/DATA/development/projects/repos/fuwa/tests/shell_smoke.lua`

## Read these `/IDE` reference files

- `/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/EditorPane.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/TerminalPane.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/PhoneShell.svelte`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/engine/runtime-bridge.js`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/RuntimeSession.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/adapter.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/worker.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/engine/types.ts`
- `/mnt/DATA/development/projects/repos/IDE/src/ui/mobile/*`

## Deliverables

Produce:

1. A feature comparison table with `implemented`, `partial`, or `missing`.
2. A list of current `fuwa` regressions that must be fixed before payload
   migration.
3. A list of `/IDE` desktop features that are still not ported.
4. A list of things that look implemented in `fuwa` but are actually only
   proof-level scaffolding.
5. A grounded recommendation on whether `/IDE` payloads are ready to migrate
   now, or whether more host/runtime work must land first.

## Constraints

- Be skeptical.
- Do not assume phase 9 or 10 are complete unless the code proves it.
- Do not assume browser runtime support exists unless it is fully wired.
- Do not assume a widget mount equals a real feature port.
- Do not assume `README.md` is fully accurate if code and tests disagree.
- Do not suggest modifying `/IDE`.

## Output style

- Start with the blunt verdict.
- Then provide a feature matrix.
- Then give the blockers.
- Then give the migration recommendation.
- End with the minimum safe next step.

