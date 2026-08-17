package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local helper = require("tests.unit.compiler._helpers")

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

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

function t.same(actual, expected, label)
	local function compare(left, right, path)
		if type(left) ~= type(right) then
			error(string.format("%s type mismatch: %s vs %s", path, type(left), type(right)), 0)
		end

		if type(left) ~= "table" then
			if left ~= right then
				error(string.format("%s mismatch: %s vs %s", path, tostring(left), tostring(right)), 0)
			end
			return
		end

		for key, value in pairs(left) do
			compare(value, right[key], path .. "." .. tostring(key))
		end
		for key, value in pairs(right) do
			if left[key] == nil then
				compare(left[key], value, path .. "." .. tostring(key))
			end
		end
	end

	compare(actual, expected, label or "value")
end

t.context = helper.context
t.lines = helper.lines
t.join = helper.join
t.compile_module = helper.compile_module
t.compile_view = helper.compile_view
t.compile_runtime = helper.compile_runtime
t.package_web = helper.package_web
t.format_diagnostics = helper.format_diagnostics
t.load_chunk = helper.load_chunk

local modules = {
	"diagnostics",
	"lines",
	"strings",
	"responses",
	"imports",
	"schema",
	"routes",
	"actions",
	"modules",
	"package_web",
	"view"
}

for _, name in ipairs(modules) do
	require("tests.unit.compiler." .. name)(t)
end

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("compiler unit tests passed (%d tests)", results.passed))
