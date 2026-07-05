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

local function encode_form_component(value)
	return (tostring(value or ""):gsub("\n", "\r\n"):gsub("([^%w%-%._~])", function(char)
		return string.format("%%%02X", char:byte())
	end))
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
	assert_true(output:find("Browser runtime", 1, true) ~= nil, "expected browser runtime badge")
	assert_true(output:find('data-preview-stage', 1, true) ~= nil, "expected browser runtime stage")
	assert_true(output:find('src="/payload/current/"', 1, true) == nil, "expected no route-backed iframe")
	assert_true(output:find("tenant-bridge.js", 1, true) == nil, "expected no tenant bridge hook")
	assert_true(output:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected local htmx asset")
	assert_true(output:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected local petite-vue asset")
	assert_true(output:find('/vendor/xterm/xterm-6.0.0.css', 1, true) ~= nil, "expected local xterm stylesheet")
	assert_true(output:find('/shell/hooks/editor.js', 1, true) ~= nil, "expected editor hook asset")
	assert_true(output:find('/shell/hooks/terminal.js', 1, true) ~= nil, "expected terminal hook asset")
	assert_true(output:find('/shell/hooks/preview-server.js', 1, true) == nil, "expected no server preview driver in the default shell")
	assert_true(output:find('/shell/hooks/preview-browser.js', 1, true) ~= nil, "expected browser preview driver")
	assert_true(output:find('/shell/hooks/preview.js', 1, true) ~= nil, "expected preview mode controller")
	assert_true(output:find('<script type="importmap">', 1, true) ~= nil, "expected import map")
	assert_true(output:find('"@codemirror/state": "/vendor/codemirror/state-6.6.0.js"', 1, true) ~= nil, "expected literal codemirror import map")
	assert_true(output:find('&quot;@codemirror/state&quot;', 1, true) == nil, "expected unescaped codemirror import map")
	assert_true(output:find('.shell-widget-shell[data-widget-state="mounted"]', 1, true) ~= nil, "expected literal CSS selectors")
	assert_true(output:find('hx-post="/switch/lesson"', 1, true) ~= nil, "expected shell switch button")
	assert_true(output:find('hx-post="/save/current"', 1, true) == nil, "expected no shell save button")
	assert_true(output:find('hx-target="#shell-content"', 1, true) ~= nil, "expected shell fragment target")
	assert_true(output:find("EventSource('/__dev/reload')", 1, true) == nil, "expected no full-page reload script in the shell host page")
end

local function test_response_builder()
	local response = dev.build_response("shell", "GET", "/", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected build_response to succeed")
	assert_true(response.body:find("<!DOCTYPE html>", 1, true) == 1, "expected doctype first")
	assert_true(response.headers["Content-Type"] == "text/html; charset=utf-8", "expected HTML content type")
	assert_true(response.body:find("Browser runtime", 1, true) ~= nil, "expected shell response")
	assert_true(response.body:find("In-memory live session", 1, true) ~= nil, "expected browser runtime footnote")
	assert_true(response.body:find('<div class="ide-shell" v-scope="FuwaShellWorkspace.createState()">', 1, true) ~= nil, "expected petite-vue on the stable shell parent")
	assert_true(response.body:find('data-preview-stage', 1, true) ~= nil, "expected browser runtime stage")
	assert_true(response.body:find('src="/payload/current/"', 1, true) == nil, "expected no route-backed iframe")
	assert_true(response.body:find("tenant-bridge.js", 1, true) == nil, "expected no shell bridge hook")
	assert_true(response.body:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "expected local htmx asset")
	assert_true(response.body:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "expected local petite-vue asset")
	assert_true(response.body:find('/vendor/xterm/xterm-6.0.0.css', 1, true) ~= nil, "expected local xterm stylesheet")
	assert_true(response.body:find('/shell/hooks/editor.js', 1, true) ~= nil, "expected editor hook asset")
	assert_true(response.body:find('/shell/hooks/terminal.js', 1, true) ~= nil, "expected terminal hook asset")
	assert_true(response.body:find('<script type="importmap">', 1, true) ~= nil, "expected import map")
	assert_true(response.body:find('"@codemirror/state": "/vendor/codemirror/state-6.6.0.js"', 1, true) ~= nil, "expected literal codemirror import map")
	assert_true(response.body:find('&quot;@codemirror/state&quot;', 1, true) == nil, "expected unescaped codemirror import map")
	assert_true(response.body:find('hx-post="/switch/lesson"', 1, true) ~= nil, "expected switch button")
	assert_true(response.body:find('hx-post="/save/current"', 1, true) == nil, "expected no save action in the default shell")
end

local function test_shell_switch_route()
	local response = dev.build_response("shell", "POST", "/switch/lesson", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected switch route to succeed")
	assert_true(response.body:find('id="shell-content"', 1, true) ~= nil, "expected shell workspace fragment")
	assert_true(response.body:find('hx-post="/save/lesson"', 1, true) == nil, "expected no lesson save action")
	assert_true(response.body:find('hx-get="/inspect/lesson?file=', 1, true) ~= nil, "expected lesson file inspection links")
	assert_true(response.body:find('Publish + run', 1, true) == nil, "expected no publish and run label")
	assert_true(response.body:find('data-draft-indicator', 1, true) == nil, "expected no draft indicator")
	assert_true(response.body:find('data-draft-discard', 1, true) == nil, "expected no draft discard control")
	assert_true(response.body:find('Browser live updates only', 1, true) ~= nil, "expected browser-only editor note")
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
	assert_true(output:find("EventSource('/__dev/reload')", 1, true) ~= nil, "expected dev reload script in tenant documents")

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
	assert_true(editor_js:find("new EditorView", 1, true) ~= nil, "expected codemirror mount")
	assert_true(editor_js:find('input[name="contents"]', 1, true) ~= nil, "expected hidden contents carrier")
	assert_true(editor_js:find("reason + ':fallback'", 1, true) ~= nil, "expected editor fallback remount logging")
		assert_true(editor_js:find("backgroundColor: '#1a1b26'", 1, true) ~= nil, "expected dark editor theme")
		assert_true(editor_js:find("dark: true", 1, true) ~= nil, "expected dark CodeMirror mode")
		assert_true(editor_js:find("textarea.hidden = true", 1, true) == nil, "expected no textarea handoff")
		assert_true(editor_js:find("buildLuaHighlights", 1, true) ~= nil, "expected local Lua syntax highlighting")
	assert_true(editor_js:find("cm-lua-keyword", 1, true) ~= nil, "expected keyword styling")
	assert_true(editor_js:find("cm-lua-string", 1, true) ~= nil, "expected string styling")

	local workspace_js = run_command(
		"printf 'GET /shell/hooks/workspace.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(workspace_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected workspace hook to respond")
	assert_true(workspace_js:find("createState", 1, true) ~= nil, "expected petite-vue workspace state")
	assert_true(workspace_js:find("open_popover", 1, true) ~= nil, "expected single popover state")
	assert_true(workspace_js:find("getBoundingClientRect", 1, true) == nil, "expected no manual popover geometry hack")
	assert_true(workspace_js:find("boot:mount-shell", 1, true) ~= nil, "expected petite-vue boot mount")
	assert_true(workspace_js:find("document.querySelector('[data-workspace]')", 1, true) ~= nil, "expected petite-vue workspace remount")
	assert_true(workspace_js:find("htmx:afterSwap", 1, true) ~= nil, "expected petite-vue remount after swaps")

	local runtime_worker_js = run_command(
		"printf 'GET /shell/hooks/runtime-worker.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(runtime_worker_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected runtime worker to respond")
	assert_true(runtime_worker_js:find('/vendor/sqlite-wasm/index.mjs', 1, true) ~= nil, "expected sqlite-wasm module import")
	assert_true(runtime_worker_js:find('/vendor/sqlite-wasm/sqlite3.wasm', 1, true) ~= nil, "expected sqlite-wasm wasm asset")
	assert_true(runtime_worker_js:find("sqljs", 1, true) == nil, "expected no sql.js backend")

		local tenant_runtime_js = run_command(
			"printf 'GET /shell/hooks/tenant-runtime.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
		)
		assert_true(tenant_runtime_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected tenant runtime to respond")
		assert_true(tenant_runtime_js:find("rewriteDocumentUrls", 1, true) ~= nil, "expected tenant URL rewrite helper")
		assert_true(tenant_runtime_js:find("fresh.async = false", 1, true) ~= nil, "expected ordered script replay")
		assert_true(tenant_runtime_js:find("responseUrl", 1, true) ~= nil, "expected response URL contract")
		assert_true(tenant_runtime_js:find("window.location.href", 1, true) ~= nil, "expected same-origin URL resolution")

		local runtime_session_js = run_command(
			"printf 'GET /shell/hooks/runtime-session.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
		)
		assert_true(runtime_session_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected runtime session to respond")
		assert_true(runtime_session_js:find("resolveResponseUrl", 1, true) ~= nil, "expected request path normalization")
		assert_true(runtime_session_js:find("appBasePath", 1, true) ~= nil, "expected payload base propagation")

	local terminal_js = run_command(
		"printf 'GET /shell/hooks/terminal.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(terminal_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected terminal hook to respond")
	assert_true(terminal_js:find("window.FuwaShellTerminal", 1, true) ~= nil, "expected terminal hook contract")
	assert_true(terminal_js:find("data-terminal-root", 1, true) ~= nil, "expected terminal mount selector")
	assert_true(terminal_js:find("new Terminal", 1, true) ~= nil, "expected xterm mount")
	assert_true(terminal_js:find("reason + ':fallback'", 1, true) ~= nil, "expected terminal fallback remount logging")

	local xterm_mjs = run_command(
		"printf 'GET /vendor/xterm/xterm-6.0.0.mjs HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(xterm_mjs:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected xterm module asset to respond")
	assert_true(xterm_mjs:find("Content-Type: application/javascript; charset=utf-8", 1, true) ~= nil, "expected xterm module MIME type")

	local xterm_fit = run_command(
		"printf 'GET /vendor/xterm/addon-fit-0.11.0.mjs HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(xterm_fit:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected xterm addon asset to respond")
	assert_true(xterm_fit:find("Content-Type: application/javascript; charset=utf-8", 1, true) ~= nil, "expected xterm addon MIME type")

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

	local codemirror_style_mod = run_command(
		"printf 'GET /vendor/codemirror/style-mod-4.1.3.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(codemirror_style_mod:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected codemirror style-mod asset to respond")
	assert_true(codemirror_style_mod:find("StyleModule", 1, true) ~= nil, "expected style-mod contents")
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

local function test_shell_inspect_fragment()
	local response = dev.build_response("shell", "GET", "/inspect/current?file=view.fuwa", "", {
		allow_host = true,
	})

	assert_true(response.status == 200, "expected inspect route to succeed")
	assert_true(response.body:find('id="ide-workspace"', 1, true) ~= nil, "expected workspace fragment root")
	assert_true(response.body:find('id="shell-content"', 1, true) == nil, "expected inspect to leave the shell frame alone")
	assert_true(response.body:find("shell-preview-frame", 1, true) == nil, "expected inspect to leave the preview iframe alone")
	assert_true(response.body:find('data-popover="search"', 1, true) ~= nil, "expected search popover")
	assert_true(response.body:find('data-popover="list"', 1, true) ~= nil, "expected file list dropdown")
	assert_true(response.body:find('data-selected="true"', 1, true) ~= nil, "expected an active file highlight")
	assert_true(response.body:find('data-file-path="view.fuwa"', 1, true) ~= nil, "expected the inspected file in the list")
	assert_true(response.body:find("breadcrumb-segment", 1, true) ~= nil, "expected breadcrumb context")
	assert_true(response.body:find('id="ide-entry-stat" hx-swap-oob="true"', 1, true) ~= nil, "expected entry stat OOB update")
end

local function test_shell_save_route_is_not_exposed()
	local response = dev.build_response("shell", "POST", "/save/current", "", {
		allow_host = true,
	})

	assert_true(response.body:find("The requested route was not found.", 1, true) ~= nil,
		"expected save route to be removed from the default shell")
end

local function test_browser_runtime_routes()
	local bundle_response = dev.build_bundle_response("current")
	assert_true(bundle_response.status == 200, "expected bundle route to succeed")
	assert_true(bundle_response.headers["Content-Type"] == "application/json; charset=utf-8", "expected JSON bundle")
	assert_true(bundle_response.body:find('"ok":true', 1, true) ~= nil, "expected clean payload bundle")
	assert_true(bundle_response.body:find('"entry":"main.lua"', 1, true) ~= nil, "expected bundle entry")
	assert_true(bundle_response.body:find('"main.lua":', 1, true) ~= nil, "expected compiled main.lua in bundle")
	assert_true(bundle_response.body:find("runtime/stdlib/db.lua", 1, true) ~= nil, "expected stdlib VFS in bundle")

	-- Browser-only mode is the default: the worker recompiles edits in-VM, so
	-- every bundle must ship the raw .fuwa sources and the compiler modules.
	-- Without them the in-worker require("...compiler.package_web") fails and
	-- live reload dies (surfacing as "decoration.target is null" per keystroke).
	assert_true(bundle_response.body:find('"sources":', 1, true) ~= nil, "expected raw sources in default bundle")
	assert_true(bundle_response.body:find("runtime/stdlib/compiler/package_web.lua", 1, true) ~= nil,
		"expected the compiler in the default bundle VFS")
	assert_true(bundle_response.body:find('"runtime/trace.lua"', 1, true) ~= nil,
		"expected runtime/trace.lua in the default bundle VFS")
	assert_true(bundle_response.body:find('"runtime/log.lua"', 1, true) ~= nil,
		"expected runtime/log.lua in the default bundle VFS")

	local invalid = dev.build_bundle_response("../etc")
	assert_true(invalid.status == 404, "expected invalid payload id to 404")

	local tenant_html = run_command(
		"printf 'GET /runtime/tenant.html HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(tenant_html:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected tenant document route")
	assert_true(tenant_html:find('data-browser-runtime="tenant"', 1, true) ~= nil, "expected tenant runtime marker")
	assert_true(tenant_html:find("/shell/hooks/tenant-runtime.js", 1, true) ~= nil, "expected tenant bridge script")
	assert_true(tenant_html:find("/vendor/htmx/htmx-1.9.12.min.js", 1, true) ~= nil, "expected vendor htmx in tenant document")

	local worker_js = run_command(
		"printf 'GET /shell/hooks/runtime-worker.js HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
	)
	assert_true(worker_js:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected worker asset to respond")
	assert_true(worker_js:find("importScripts('/vendor/wasmoon/wasmoon-1.16.0.js'", 1, true) ~= nil, "expected vendor wasmoon import")
	assert_true(worker_js:find("__fuwaBrowser", 1, true) ~= nil, "expected worker message marker")

	local wasm_asset = run_command(
		"printf 'GET /vendor/wasmoon/glue-1.16.0.wasm HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua | head -c 400"
	)
	assert_true(wasm_asset:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected wasm asset to respond")
	assert_true(wasm_asset:find("Content%-Type: application/wasm") ~= nil, "expected wasm MIME type")
end

local function test_draft_overlay_routes()
	local function file_exists(path)
		local file = io.open(path, "rb")
		if file then
			file:close()
			return true
		end
		return false
	end

	local marker = "draft-marker-" .. tostring(os.time())
	local draft_dir = ".fuwa-dev/drafts/current"
	local draft_view_path = draft_dir .. "/views/layout.fuwa"
	local original_view = read_file("payloads/current/views/layout.fuwa")
	assert_true(original_view ~= nil, "expected payload layout.fuwa to exist")
	local draft_view = original_view:gsub("<body>", '<body class="' .. marker .. '">', 1)
	assert_true(draft_view ~= original_view, "expected layout body tag to accept the draft marker")

	run_command("rm -rf " .. shell_quote(draft_dir) .. " 2>/dev/null; true")

	local ok, err = pcall(function()
		-- Draft write lands in the overlay, never in the payload tree.
		local write_response = dev.build_draft_write_response(
			"current",
			"path=views/layout.fuwa&contents=" .. encode_form_component(draft_view)
		)
		assert_true(write_response.status == 200, "expected draft write to succeed")
		assert_true(write_response.body:find('"ok":true', 1, true) ~= nil, "expected draft write ok body")
		assert_true(file_exists(draft_view_path), "expected draft file in the overlay")
		assert_true(read_file("payloads/current/views/layout.fuwa") == original_view,
			"expected the payload source tree to stay untouched by draft writes")

		-- Sanitizers: bad ids and traversal paths are rejected.
		assert_true(dev.build_draft_write_response("../etc", "path=x.txt&contents=x").status == 404,
			"expected invalid draft payload id to 404")
		assert_true(dev.build_draft_write_response("current", "path=../evil.txt&contents=x").status == 400,
			"expected draft path traversal to be rejected")
		assert_true(dev.build_draft_write_response("current", "path=/abs.txt&contents=x").status == 400,
			"expected absolute draft path to be rejected")

		-- Preview route compiles with the overlay; the published route does not.
		local preview_html = run_command(
			"printf 'GET /preview/current/ HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
		)
		assert_true(preview_html:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected preview route to respond")
		assert_true(preview_html:find(marker, 1, true) ~= nil, "expected draft overlay in preview output")
		assert_true(preview_html:find('hx-post="/preview/current/counter"', 1, true) ~= nil,
			"expected payload routes rebased onto the preview surface")
		assert_true(preview_html:find('hx-post="/payload/current/counter"', 1, true) == nil,
			"expected no published-route interactions inside a draft preview")

		local published_html = run_command(
			"printf 'GET /payload/current/ HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
		)
		assert_true(published_html:find("HTTP/1.1 200 OK", 1, true) ~= nil, "expected payload route to respond")
		assert_true(published_html:find(marker, 1, true) == nil, "expected published route to ignore drafts")

		-- Bundle route: ?draft=1 sees the overlay, the plain bundle does not.
		local draft_bundle = dev.build_bundle_response("current", { draft = true })
		assert_true(draft_bundle.status == 200, "expected draft bundle to build")
		assert_true(draft_bundle.body:find(marker, 1, true) ~= nil, "expected draft overlay in draft bundle")

		local plain_bundle = dev.build_bundle_response("current")
		assert_true(plain_bundle.status == 200, "expected plain bundle to build")
		assert_true(plain_bundle.body:find(marker, 1, true) == nil, "expected plain bundle to ignore drafts")

		-- Static traversal is rejected on mount routes.
		local traversal = run_command(
			"printf 'GET /payload/current/../../README.md HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | lua5.4 runtime/fuwa-dev.lua"
		)
		assert_true(traversal:find("HTTP/1.1 404 Not Found", 1, true) ~= nil, "expected static path traversal to 404")

		-- Publishing the file clears its draft copy.
		local caps = require("runtime.host.capabilities")
		local host = caps.new({})
		local publish = host.write_payload_file("current", "views/layout.fuwa", original_view)
		assert_true(publish.ok == true, "expected publish to succeed")
		assert_true(not file_exists(draft_view_path), "expected publish to clear the draft copy")

		-- Discard deletes the whole overlay.
		local rewrite = dev.build_draft_write_response("current", "path=views/layout.fuwa&contents=" .. encode_form_component(draft_view))
		assert_true(rewrite.status == 200, "expected second draft write to succeed")
		local discard = dev.build_draft_discard_response("current", "")
		assert_true(discard.status == 200, "expected draft discard to succeed")
		assert_true(not file_exists(draft_view_path), "expected discard to remove draft files")
	end)

	run_command("rm -rf " .. shell_quote(draft_dir) .. " 2>/dev/null; true")
	write_file("payloads/current/views/layout.fuwa", original_view)
	assert_true(ok, err)
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
test_shell_save_route_is_not_exposed()
test_shell_inspect_fragment()
test_browser_runtime_routes()
test_draft_overlay_routes()
test_db_helper()

print("dev server smoke checks passed")
