package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local dev = require("runtime.fuwa-dev")

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
	assert_true(output:find("Fuwa Dev", 1, true) ~= nil, "expected rendered payload")
	assert_true(output:find("EventSource('/__dev/reload')", 1, true) ~= nil, "expected reload script")
end

local function test_response_builder()
	local response = dev.build_response("payloads/current", "GET", "/", "")

	assert_true(response.status == 200, "expected build_response to succeed")
	assert_true(response.headers["Content-Type"] == "text/html; charset=utf-8", "expected HTML content type")

	local script_pos = response.body:find("EventSource('/__dev/reload')", 1, true)
	local body_pos = response.body:find("</body>", 1, true)
	assert_true(script_pos ~= nil, "expected reload script")
	assert_true(body_pos ~= nil, "expected closing body tag")
	assert_true(script_pos < body_pos, "expected reload script before </body>")
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
test_db_helper()

print("dev server smoke checks passed")
