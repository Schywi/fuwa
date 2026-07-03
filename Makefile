# fuwa — task entrypoints. Single source of truth for "what CI runs".
# Every test file is a standalone script that exits non-zero on failure.
# Tests must run from the repo root (they set package.path relative to ./).

LUA ?= lua5.4

# Fast, no external deps beyond the Lua interpreter.
UNIT_TESTS       = tests/unit/compiler.lua tests/unit/browser.lua tests/unit/db.lua tests/unit/host.lua tests/unit/trace.lua
SMOKE_TESTS      = tests/compiler_smoke.lua tests/shell_smoke.lua
ACCEPTANCE_TESTS = tests/acceptance.lua
# Needs python3 (the sqlite_local provider shells out to a python helper).
INTEGRATION_TESTS = tests/dev_server_smoke.lua

.PHONY: help test test-unit test-smoke test-acceptance test-integration compile-check lint

help:
	@echo "Targets:"
	@echo "  compile-check     parse every tracked .lua (stage 1: does it compile?)"
	@echo "  lint              luacheck static analysis (stage 2)"
	@echo "  test-unit         fast unit suites (stage 3)"
	@echo "  test-smoke        compiler + shell smoke checks"
	@echo "  test-acceptance   acceptance suites"
	@echo "  test-integration  dev server smoke (needs python3)"
	@echo "  test              everything, fail-fast, cheapest first"

# Stage 1 — does every Lua file even parse? loadfile parse-checks without running.
compile-check:
	@echo ">> compile-check: parsing every tracked .lua"
	@git ls-files '*.lua' | while read -r f; do \
		$(LUA) -e "assert(loadfile('$$f'))" || { echo "PARSE FAIL: $$f"; exit 1; }; \
	done
	@echo "OK: all Lua files parse"

# Stage 2 — static analysis. Advisory until the tree is luacheck-clean.
lint:
	@command -v luacheck >/dev/null 2>&1 || { echo "luacheck not installed; skipping"; exit 0; }
	luacheck runtime tests shell

# Stage 3 — fast suites.
test-unit:
	@for f in $(UNIT_TESTS); do echo ">> $$f"; $(LUA) $$f || exit 1; done

test-smoke:
	@for f in $(SMOKE_TESTS); do echo ">> $$f"; $(LUA) $$f || exit 1; done

test-acceptance:
	@for f in $(ACCEPTANCE_TESTS); do echo ">> $$f"; $(LUA) $$f || exit 1; done

# Stage 5 — integration (needs python3).
test-integration:
	@for f in $(INTEGRATION_TESTS); do echo ">> $$f"; $(LUA) $$f || exit 1; done

# Everything, cheapest first so a parse error fails in seconds, not minutes.
test: compile-check test-unit test-smoke test-acceptance test-integration
	@echo "ALL TESTS PASSED"
