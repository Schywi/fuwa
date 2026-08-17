-- Static-analysis config for luacheck.
-- Kept conservative on purpose: the high-value signal is undefined globals
-- (catches typos and hallucinated APIs), not stylistic nits.

std = "lua54"
cache = true
max_line_length = false

-- Unused function arguments / loop vars are common and low-signal here.
ignore = {
	"212", -- unused argument
	"213", -- unused loop variable
}

-- Test files intentionally build small ad-hoc harnesses; don't nag about
-- redefining locals like `t` across suites.
files["tests/**/*.lua"] = {
	ignore = { "421", "431", "432" },
}
