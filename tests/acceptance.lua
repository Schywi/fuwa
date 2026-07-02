package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local results = {
	passed = 0,
	failed = 0,
	failures = {}
}

local t = {}

function t.test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		results.passed = results.passed + 1
		return
	end

	results.failed = results.failed + 1
	results.failures[#results.failures + 1] = string.format("%s\n  %s", name, tostring(err))
end

function t.eq(actual, expected, label)
	if actual ~= expected then
		error(string.format("%s expected %s, got %s", label or "equality check", tostring(expected), tostring(actual)), 2)
	end
end

function t.truthy(value, label)
	if not value then
		error(label or "expected truthy value", 2)
	end
end

function t.falsy(value, label)
	if value then
		error(label or "expected falsy value", 2)
	end
end

local modules = {
	"current_payload",
	"shell_host"
}

for _, name in ipairs(modules) do
	require("tests.acceptance." .. name)(t)
end

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("acceptance tests passed (%d tests)", results.passed))
