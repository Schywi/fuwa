local dev = require("runtime.fuwa-dev")
local db = require("runtime.db")

local function cleanup_temp_db(path)
	os.remove(path)
	os.remove(path .. "-journal")
	os.remove(path .. "-wal")
	os.remove(path .. "-shm")
end

local function with_temp_sqlite_provider(fn)
	local path = os.tmpname() .. ".sqlite"
	local provider = db.new("sqlite_local", { path = path })
	local ok, err = pcall(fn, provider)
	cleanup_temp_db(path)
	assert(ok, err)
end

local function render_sequence(provider)
	local get = dev.build_response("payloads/current", "GET", "/", "", {
		db_provider = provider
	})
	local post1 = dev.build_response("payloads/current", "POST", "/counter", "", {
		db_provider = provider
	})
	local post2 = dev.build_response("payloads/current", "POST", "/counter", "", {
		db_provider = provider
	})
	return get, post1, post2
end

local function run_command(command)
	local pipe = assert(io.popen(command, "r"))
	local output = pipe:read("*a") or ""
	local ok, why, code = pipe:close()
	assert(ok, string.format("command failed (%s %s): %s", tostring(why), tostring(code), command))
	return output
end

local function assert_payload_markup(t, response)
	t.truthy(response.body:find('hx-post="/payload/current/counter"', 1, true) ~= nil, "expected htmx button")
	t.truthy(response.body:find('v-scope="{ pressed: false }"', 1, true) ~= nil, "expected petite-vue scope")
	t.truthy(response.body:find('script defer src="browser.js"', 1, true) ~= nil, "expected browser.js asset")
	t.truthy(response.body:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected htmx loader")
	t.truthy(response.body:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected petite-vue loader")
	t.truthy(response.body:find("bg-emerald-500", 1, true) ~= nil, "expected utility-style classes")
end

return function(t)
	t.test("current payload renders identically with memory and sqlite_local", function()
		local memory_get, memory_post1, memory_post2 = render_sequence(db.new("memory"))
		t.truthy(memory_get.body:find("<!DOCTYPE html>", 1, true) == 1, "expected doctype first")
		assert_payload_markup(t, memory_get)
		t.truthy(memory_post1.body:find("Clicks: 1", 1, true) ~= nil, "expected first increment")
		t.truthy(memory_post2.body:find("Clicks: 2", 1, true) ~= nil, "expected second increment")

		with_temp_sqlite_provider(function(provider)
			local sqlite_get, sqlite_post1, sqlite_post2 = render_sequence(provider)

			t.eq(sqlite_get.body, memory_get.body, "expected identical GET body")
			t.eq(sqlite_post1.body, memory_post1.body, "expected identical first POST body")
			t.eq(sqlite_post2.body, memory_post2.body, "expected identical second POST body")
			t.truthy(sqlite_post1.body:find("EventSource('/__dev/reload')", 1, true) == nil, "expected fragment response without reload script")
			t.truthy(sqlite_post2.body:find("EventSource('/__dev/reload')", 1, true) == nil, "expected fragment response without reload script")
		end)
	end)

	t.test("current payload browser asset is served raw", function()
		local body = run_command("printf 'GET /payload/current/browser.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua")

		t.truthy(body:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected browser asset to respond")
		t.truthy(body:find("fuwaBrowser", 1, true) ~= nil, "expected browser.js contents")
	end)
end
