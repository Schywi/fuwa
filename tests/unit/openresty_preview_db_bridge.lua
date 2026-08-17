package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local bridge = require("runtime.openresty.preview.db_bridge")

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

local function cleanup_temp_db(path)
	os.remove(path)
	os.remove(path .. "-journal")
	os.remove(path .. "-wal")
	os.remove(path .. "-shm")
end

t.test("preview db bridge uses preview slug tenant scope", function()
	local path = os.tmpname() .. ".sqlite"
	local alpha = bridge.new({
		slug = "alpha",
		path = path,
	})
	local beta = bridge.new({
		slug = "beta",
		path = path,
	})

	local create_alpha = alpha({
		op = "create",
		collection = "wallets",
		data = {
			id = "main",
			balance = 100,
		}
	}):await()
	local create_beta = beta({
		op = "create",
		collection = "wallets",
		data = {
			id = "main",
			balance = 25,
		}
	}):await()

	t.truthy(create_alpha.ok, "expected alpha create")
	t.truthy(create_beta.ok, "expected beta create")

	local found_alpha = alpha({
		op = "find",
		collection = "wallets",
		id = "main",
	}):await()
	local found_beta = beta({
		op = "find",
		collection = "wallets",
		id = "main",
	}):await()

	t.eq(found_alpha.value.balance, 100, "expected alpha tenant state")
	t.eq(found_beta.value.balance, 25, "expected beta tenant state")

	cleanup_temp_db(path)
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n") .. "\n")
	os.exit(1)
end

print(string.format("ok - %d assertion groups", results.passed))
