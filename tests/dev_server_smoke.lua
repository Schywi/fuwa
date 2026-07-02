package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local dev = require("runtime.fuwa-dev")
local db = require("runtime.db")

local function assert_true(condition, message)
	if not condition then
		error(message or "assertion failed", 2)
	end
end

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", [['"'"']]) .. "'"
end

local function write_file(path, contents)
	local file = assert(io.open(path, "wb"))
	file:write(contents or "")
	file:close()
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

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
	assert_true(ok, err)
end

local function run_command(command)
	local pipe = assert(io.popen(command, "r"))
	local output = pipe:read("*a") or ""
	local ok, why, code = pipe:close()
	assert_true(ok, string.format("command failed (%s %s): %s", tostring(why), tostring(code), command))
	return output
end

local function test_http_request()
	local output = run_command(
		"printf 'GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)

	assert_true(output:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected HTTP 200")
	assert_true(output:find("<!DOCTYPE html>", 1, true) ~= nil, "expected doctype")
	assert_true(output:find("Fuwa host shell", 1, true) ~= nil, "expected rendered shell")
	assert_true(output:find("data-host-slot=\"preview\"", 1, true) ~= nil, "expected preview slot")
	assert_true(output:find('src="/payload/current/"', 1, true) ~= nil, "expected routed iframe")
	assert_true(output:find('sandbox="allow-scripts allow-forms allow-same-origin"', 1, true) ~= nil, "expected same-origin sandbox")
	assert_true(output:find('hx-post="/switch/lesson"', 1, true) ~= nil, "expected shell switch button")
	assert_true(output:find("EventSource('/__dev/reload')", 1, true) ~= nil, "expected reload script")
end

local function test_response_builder()
	local response = dev.build_response("shell", "GET", "/", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected build_response to succeed")
	assert_true(response.body:find("<!DOCTYPE html>", 1, true) == 1, "expected doctype first")
	assert_true(response.headers["Content-Type"] == "text/html; charset=utf-8", "expected HTML content type")
	assert_true(response.body:find("Fuwa host shell", 1, true) ~= nil, "expected shell response")
	assert_true(response.body:find("data-host-slot=\"preview\"", 1, true) ~= nil, "expected preview slot")
	assert_true(response.body:find('src="/payload/current/"', 1, true) ~= nil, "expected routed iframe")
	assert_true(response.body:find('sandbox="allow-scripts allow-forms allow-same-origin"', 1, true) ~= nil, "expected same-origin sandbox")

	local script_pos = response.body:find("EventSource('/__dev/reload')", 1, true)
	local body_pos = response.body:find("</body>", 1, true)
	assert_true(script_pos ~= nil, "expected reload script")
	assert_true(body_pos ~= nil, "expected closing body tag")
	assert_true(script_pos < body_pos, "expected reload script before </body>")
end

local function test_shell_switch_route()
	local response = dev.build_response("shell", "POST", "/switch/lesson", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected switch route to succeed")
	assert_true(response.body:find('src="/payload/lesson/"', 1, true) ~= nil, "expected switched payload route")
	assert_true(response.body:find('data-host-slot="primary"', 1, true) ~= nil, "expected primary slot")
end

local function test_payload_route_request()
	local output = run_command(
		"printf 'GET /payload/current/ HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)

	assert_true(output:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected payload route 200")
	assert_true(output:find("Fuwa Dev", 1, true) ~= nil, "expected payload body")
	assert_true(output:find('hx-post="counter"', 1, true) ~= nil, "expected relative payload action")

	local post_output = run_command(
		"printf 'POST /payload/current/counter HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: 0\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)

	assert_true(post_output:find("Clicks: 1", 1, true) ~= nil, "expected payload counter route to work")
end

local function test_current_payload_interaction()
	with_temp_sqlite_provider(function(provider)
		local response = dev.build_response("payloads/current", "GET", "/", "", {
			db_provider = provider
		})
		assert_true(response.body:find('hx-post="counter"', 1, true) ~= nil, "expected htmx button")
		assert_true(response.body:find('v-scope="{ pressed: false }"', 1, true) ~= nil, "expected petite-vue scope")
		assert_true(response.body:find("https://unpkg.com/htmx.org", 1, true) ~= nil, "expected htmx script")
		assert_true(response.body:find("https://unpkg.com/petite-vue?module", 1, true) ~= nil, "expected petite-vue script")
		assert_true(response.body:find("bg-emerald-500", 1, true) ~= nil, "expected utility-style classes")

		local first = dev.build_response("payloads/current", "POST", "/counter", "", {
			db_provider = provider
		})
		assert_true(first.body:find("Clicks: 1", 1, true) ~= nil, "expected first counter increment")
		assert_true(first.body:find("EventSource('/__dev/reload')", 1, true) == nil, "expected fragment response without reload script")

		local second = dev.build_response("payloads/current", "POST", "/counter", "", {
			db_provider = provider
		})
		assert_true(second.body:find("Clicks: 2", 1, true) ~= nil, "expected persisted counter increment")
		assert_true(second.body:find("EventSource('/__dev/reload')", 1, true) == nil, "expected fragment response without reload script")
	end)
end

local function test_db_helper()
	local state_path = os.tmpname()
	local lock_path = state_path .. ".lock"
	local create_command_path = os.tmpname()
	local all_command_path = os.tmpname()

	write_file(state_path, "return {}\n")
	write_file(lock_path, "")
	write_file(create_command_path, 'return { op = "create", collection = "smoke", data = { name = "one" } }\n')
	write_file(all_command_path, 'return { op = "all", collection = "smoke" }\n')

	local create_output = run_command(string.format(
		"lua5.4 runtime/fuwa-dev.lua --db-op %s %s",
		shell_quote(state_path),
		shell_quote(create_command_path)
	))
	assert_true(create_output:find('"ok"] = true', 1, true) ~= nil, "expected create to succeed")

	local state = assert(loadfile(state_path))()
	assert_true(state.collections ~= nil and state.collections.smoke ~= nil, "expected collection state")
	assert_true(state.collections.smoke.rows[1].name == "one", "expected persisted row")

	local all_output = run_command(string.format(
		"lua5.4 runtime/fuwa-dev.lua --db-op %s %s",
		shell_quote(state_path),
		shell_quote(all_command_path)
	))
	assert_true(all_output:find('"name"] = "one"', 1, true) ~= nil, "expected row in all output")

	os.remove(create_command_path)
	os.remove(all_command_path)
	os.remove(lock_path)
	os.remove(state_path)
end

test_http_request()
test_response_builder()
test_shell_switch_route()
test_payload_route_request()
test_current_payload_interaction()
test_db_helper()

print("dev server smoke checks passed")
