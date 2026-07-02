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
	assert_true(output:find("Fuwa Shell", 1, true) ~= nil, "expected rendered shell")
	assert_true(output:find('src="/payload/current/"', 1, true) ~= nil, "expected route-backed iframe")
	assert_true(output:find("tenant-bridge.js", 1, true) == nil, "expected no tenant bridge hook")
	assert_true(output:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected local htmx asset")
	assert_true(output:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected local petite-vue asset")
	assert_true(output:find('/shell/hooks/editor.js', 1, true) ~= nil, "expected editor hook asset")
	assert_true(output:find('/shell/hooks/terminal.js', 1, true) ~= nil, "expected terminal hook asset")
	assert_true(output:find('hx-post="/switch/lesson"', 1, true) ~= nil, "expected shell switch button")
	assert_true(output:find('hx-post="/save/current"', 1, true) ~= nil, "expected shell save button")
	assert_true(output:find('hx-target="#shell-content"', 1, true) ~= nil, "expected shell fragment target")
end

local function test_response_builder()
	local response = dev.build_response("shell", "GET", "/", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected build_response to succeed")
	assert_true(response.body:find("<!DOCTYPE html>", 1, true) == 1, "expected doctype first")
	assert_true(response.headers["Content-Type"] == "text/html; charset=utf-8", "expected HTML content type")
	assert_true(response.body:find("Route-backed tenant iframe", 1, true) ~= nil, "expected shell response")
	assert_true(response.body:find('src="/payload/current/"', 1, true) ~= nil, "expected route-backed iframe")
	assert_true(response.body:find("tenant-bridge.js", 1, true) == nil, "expected no shell bridge hook")
	assert_true(response.body:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected local htmx asset")
	assert_true(response.body:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected local petite-vue asset")
	assert_true(response.body:find('/shell/hooks/editor.js', 1, true) ~= nil, "expected editor hook asset")
	assert_true(response.body:find('/shell/hooks/terminal.js', 1, true) ~= nil, "expected terminal hook asset")
	assert_true(response.body:find('hx-post="/switch/lesson"', 1, true) ~= nil, "expected switch button")
end

local function test_shell_switch_route()
	local response = dev.build_response("shell", "POST", "/switch/lesson", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected switch route to succeed")
	assert_true(response.body:find('id="shell-content"', 1, true) ~= nil, "expected shell workspace fragment")
	assert_true(response.body:find('hx-post="/save/lesson"', 1, true) ~= nil, "expected lesson save action")
	assert_true(response.body:find('hx-get="/inspect/lesson?file=', 1, true) ~= nil, "expected lesson file inspection links")
	assert_true(response.body:find("<include", 1, true) == nil, "expected rendered HTML, not literal include tags")
end

local function test_payload_route_request()
	local output = run_command(
		"printf 'GET /payload/current/ HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)

	assert_true(output:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected payload route 200")
	assert_true(output:find("Fuwa Dev", 1, true) ~= nil, "expected payload body")
	assert_true(output:find('script defer src="browser.js"', 1, true) ~= nil, "expected payload browser asset tag")
	assert_true(output:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected htmx loader")
	assert_true(output:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected petite-vue loader")

	local post_output = run_command(
		"printf 'POST /payload/current/counter HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: 0\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)

	assert_true(post_output:find("Clicks:", 1, true) ~= nil, "expected payload counter route to work")
	assert_true(post_output:find('hx-post="/payload/current/counter"', 1, true) ~= nil, "expected counter fragment markup")
end

local function test_raw_asset_requests()
	local browser_js = run_command(
		"printf 'GET /payload/current/browser.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(browser_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected browser asset to respond")
	assert_true(browser_js:find("fuwaBrowser", 1, true) ~= nil, "expected browser.js contents")

	local editor_js = run_command(
		"printf 'GET /shell/hooks/editor.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(editor_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected editor hook to respond")
	assert_true(editor_js:find("window.FuwaShellEditor", 1, true) ~= nil, "expected editor hook contract")
	assert_true(editor_js:find("data-editor-root", 1, true) ~= nil, "expected editor mount selector")

	local terminal_js = run_command(
		"printf 'GET /shell/hooks/terminal.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(terminal_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected terminal hook to respond")
	assert_true(terminal_js:find("window.FuwaShellTerminal", 1, true) ~= nil, "expected terminal hook contract")
	assert_true(terminal_js:find("data-terminal-root", 1, true) ~= nil, "expected terminal mount selector")

	local vendor_js = run_command(
		"printf 'GET /vendor/htmx/htmx-1.9.12.min.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(vendor_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected vendor asset to respond")
	assert_true(vendor_js:find("htmx", 1, true) ~= nil, "expected htmx vendor contents")

	local gsap_js = run_command(
		"printf 'GET /vendor/gsap/gsap-3.15.0.min.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(gsap_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected gsap vendor asset to respond")
	assert_true(gsap_js:find("gsap", 1, true) ~= nil, "expected gsap vendor contents")

	local unocss_js = run_command(
		"printf 'GET /vendor/unocss/runtime-mini-66.7.0.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(unocss_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected unocss vendor asset to respond")
	assert_true(unocss_js:find("__unocss_runtime", 1, true) ~= nil, "expected unocss runtime contents")

	local xterm_css = run_command(
		"printf 'GET /vendor/xterm/xterm-6.0.0.css HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(xterm_css:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected xterm css asset to respond")
	assert_true(xterm_css:find(".xterm", 1, true) ~= nil, "expected xterm css contents")

	local codemirror_state = run_command(
		"printf 'GET /vendor/codemirror/state-6.6.0.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(codemirror_state:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected codemirror vendor asset to respond")
	assert_true(codemirror_state:find("class Text", 1, true) ~= nil, "expected codemirror state contents")
end

local function test_current_payload_interaction()
	with_temp_sqlite_provider(function(provider)
		local response = dev.build_response("payloads/current", "GET", "/", "", {
			db_provider = provider
		})
		assert_true(response.body:find('hx-post="/payload/current/counter"', 1, true) ~= nil, "expected htmx button")
		assert_true(response.body:find('v-scope="{ pressed: false }"', 1, true) ~= nil, "expected petite-vue scope")
		assert_true(response.body:find('script defer src="browser.js"', 1, true) ~= nil, "expected browser.js asset")
		assert_true(response.body:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected htmx loader")
		assert_true(response.body:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected petite-vue loader")
		assert_true(response.body:find("bg-emerald-500", 1, true) ~= nil, "expected utility-style classes")

		local first = dev.build_response("payloads/current", "POST", "/counter", "", {
			db_provider = provider
		})
		assert_true(first.body:find("Clicks: 1", 1, true) ~= nil, "expected first counter increment")
		assert_true(first.body:find("EventSource('/__dev/reload')", 1, true) == nil, "expected fragment response without reload script")
		assert_true(first.body:find('hx-post="/payload/current/counter"', 1, true) ~= nil, "expected absolute counter route")

		local second = dev.build_response("payloads/current", "POST", "/counter", "", {
			db_provider = provider
		})
		assert_true(second.body:find("Clicks: 2", 1, true) ~= nil, "expected persisted counter increment")
		assert_true(second.body:find("EventSource('/__dev/reload')", 1, true) == nil, "expected fragment response without reload script")
		assert_true(second.body:find('hx-post="/payload/current/counter"', 1, true) ~= nil, "expected absolute counter route")
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
test_raw_asset_requests()
test_current_payload_interaction()
test_db_helper()

print("dev server smoke checks passed")
