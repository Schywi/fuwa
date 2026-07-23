# AGENTS.md — rules for AI agents working in fuwa

> This is the Codex entry point. Codex reads `AGENTS.md` from the repo root
> automatically. It is deliberately thin: the real rules live in
> [`.agent/rules/`](.agent/rules/) so there is one source of truth, not copies
> that drift.

**Read `.agent/rules/` before writing any code, and follow it.** In order:

1. [`.agent/rules/00-principles.md`](.agent/rules/00-principles.md) — what
   readable/clean code means here, with the buzzwords (DRY, KISS, SOLID, YAGNI,
   SoC) translated into checkable rules and their anti-dogma caveats.
2. [`.agent/rules/01-antipatterns.md`](.agent/rules/01-antipatterns.md) — the
   specific ways AI-written code goes wrong, each with a bad→good example. Scan
   your own diff against this list before finishing.
3. [`.agent/rules/02-project-conventions.md`](.agent/rules/02-project-conventions.md)
   — fuwa specifics: the non-negotiable compiler boundary, Lua style, minimal-JS
   discipline, `.fuwa` parity, contracts, fixtures.
4. [`.agent/rules/03-workflow.md`](.agent/rules/03-workflow.md) — how to work:
   understand first, smallest change, verify, when to stop and ask.

IMPORTANT WRITE COMPREENSIVE UNIT tests for changes

## The short version (the full version is in `.agent/rules/`)

- **Readable code beats clever code, always.** Optimize for the next reader.
- **YAGNI / KISS.** Build what the task needs now. No speculative abstraction,
  factories, config bags, or "just in case" parameters — this is the #1 way AI
  code goes wrong.
- **DRY with the rule of three.** Extract on the third occurrence, not the second.
  A little copying beats the wrong abstraction.
- **Respect the compiler boundary.** `compiler.core` knows nothing about the dev
  server, HTTP, workers, Wasmoon, or the TS host. Data flows
  dev server → `package_web` → `core`, never back. See
  `docs/port-compiler-to-lua.md`.
- **Minimal JavaScript.** Lua is the language. JS is glue. Do not reintroduce a
  Node/JS toolchain into the Lua path.
- **Use petite-vue for petite-vue interactions.** If a shell or tenant
  interaction can be handled cleanly with petite-vue state/directives, prefer
  that over custom JS hooks and delegated DOM state machines.
- **Put petite-vue on the stable parent.** If HTMX swaps a subtree, put
  `v-scope` on the closest ancestor that HTMX does not replace, and keep
  stateful widgets above or explicitly preserved across the swap. Do not mount
  petite-vue state on the node HTMX is about to replace.
- **Report failures through diagnostics**, never a silent empty result. Fail
  loudly.
- **One change, one purpose.** Do not reformat or refactor unrelated code in the
  same edit. Do not add dependencies or APIs that are not already here — if you
  need one, stop and ask.
- **Verify before you claim done**, and report honestly.

These rules override the immediate task when they conflict. If a task requires
breaking them, stop and surface the conflict instead of guessing.

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs via Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until code changes are committed locally.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **COMMIT LOCALLY** - This is MANDATORY:
   ```bash
   git status
   git add <changed files>
   git commit
   git status  # MUST show a clean worktree for tracked files
   ```
5. **Clean up** - Clear stashes, prune local temporary branches if needed
6. **Verify** - All changes committed locally
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until code changes are committed locally
- NEVER stop before committing code - that leaves work stranded in the worktree
- ALWAYS stage local repo changes with `git add` as part of the default completion flow
- ALWAYS create the local commit yourself once tests pass
- NEVER push as part of the default session-completion flow
- NEVER say "ready to commit when you are" - YOU must commit
