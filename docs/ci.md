# CI pipeline

Every push and pull request runs a staged, fail-fast pipeline. Cheapest
checks run first so obvious problems fail in seconds, not minutes.

```
push / PR
  └─ gatekeeper   secrets (gitleaks) · conflict markers · whitespace · markdown
       └─ build    compile-check: every .lua must parse
            ├─ lint        luacheck static analysis   (advisory for now)
            └─ unit        unit + smoke + acceptance   (the regression gate)
                 └─ integration   dev server end-to-end smoke
```

## Run it locally

The `Makefile` is the single source of truth for what CI runs:

```sh
make test              # everything, fail-fast, cheapest first
make compile-check     # just the parse check
make test-unit         # fast unit suites
make test-integration  # dev server smoke (needs python3)
make lint              # luacheck (needs luacheck installed)
```

Requirements: `lua5.4` and `python3` (the `sqlite_local` provider shells out
to a small python helper). No other runtime dependencies.

## Adding tests

Each test file is a standalone script that sets `package.path`, runs, prints
a one-line summary, and calls `os.exit(1)` on failure. When you add a new
entrypoint, wire it into the matching list in the `Makefile` so CI picks it
up — a suite that nothing invokes is a suite that silently rots.

## Known follow-ups

- `lint` is `continue-on-error` until the tree is luacheck-clean; then it
  becomes a hard gate.
- The small `t` test harness (`test/eq/truthy/...`) is duplicated across
  several suites; it should move to one shared `tests/support` module.
- SAST (semgrep rules for SQL/XSS/path-traversal) and nightly compiler
  fuzzing are planned but not yet wired.
