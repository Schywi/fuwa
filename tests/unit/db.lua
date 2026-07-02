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

local modules = {
	"provider",
	"init",
	"memory",
	"sqlite_local"
}

for _, name in ipairs(modules) do
	require("tests.unit.db." .. name)(t)
end

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("db unit tests passed (%d tests)", results.passed))
