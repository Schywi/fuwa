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

local function assert_payload_markup(t, response)
	t.truthy(response.body:find('hx-post="/counter"', 1, true) ~= nil, "expected htmx button")
	t.truthy(response.body:find('v-scope="{ pressed: false }"', 1, true) ~= nil, "expected petite-vue scope")
	t.truthy(response.body:find("https://unpkg.com/htmx.org", 1, true) ~= nil, "expected htmx script")
	t.truthy(response.body:find("https://unpkg.com/petite-vue?module", 1, true) ~= nil, "expected petite-vue script")
	t.truthy(response.body:find("bg-emerald-500", 1, true) ~= nil, "expected utility-style classes")
end

return function(t)
	t.test("current payload renders identically with memory and sqlite_local", function()
		local memory_get, memory_post1, memory_post2 = render_sequence(db.new("memory"))
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
end
