package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local store = require("runtime.openresty.deploy.store")

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

local function with_temp_db(fn)
	local path = os.tmpname() .. ".sqlite"
	_G.__FUWA_DEPLOY_DB_PATH = path
	local ok, err = pcall(fn, path)
	_G.__FUWA_DEPLOY_DB_PATH = nil
	cleanup_temp_db(path)
	assert(ok, err)
end

t.test("sqlite deploy store round-trips source and compiled snapshots", function()
	with_temp_db(function()
		local saved = store.save("preview-one", "main.lua", {
			["app.fuwa"] = "module App\n"
		}, {
			["main.lua"] = "return {}"
		}, "session-a")
		t.eq(saved.id, "preview-one", "expected explicit slug id")

		local loaded = store.load("preview-one")
		t.truthy(loaded ~= nil, "expected saved deployment")
		t.eq(loaded.entry, "main.lua", "expected entry")
		t.eq(loaded.source_files["app.fuwa"], "module App\n", "expected source snapshot")
		t.eq(loaded.compiled_files["main.lua"], "return {}", "expected compiled snapshot")
		t.eq(loaded.session_id, "session-a", "expected session id")

		store.save("preview-one", "main.lua", {
			["app.fuwa"] = "module App\n-- updated\n"
		}, {
			["main.lua"] = "return { updated = true }"
		}, "session-a")

		local updated = store.load("preview-one")
		t.eq(updated.source_files["app.fuwa"], "module App\n-- updated\n", "expected updated source snapshot")
		t.eq(updated.compiled_files["main.lua"], "return { updated = true }", "expected updated compiled snapshot")

		store.save("preview-two", "main.lua", {
			["app.fuwa"] = "module Two\n"
		}, {
			["main.lua"] = "return { two = true }"
		}, "session-a")

		local rows = store.list_by_session("session-a")
		t.eq(#rows, 2, "expected both deployments for the session")
		t.truthy(rows[1].slug ~= nil, "expected slug in list row")
	end)
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n") .. "\n")
	os.exit(1)
end

print(string.format("ok - %d assertion groups", results.passed))
