-- runtime/fuwa-dev.lua
-- Native Lua dev server for fuwa.
-- Public helpers:
--   collect_payload_files(root_dir) -> RuntimeFiles table
--   build_response(root_dir, method, path, body, opts?) -> { status, headers, body }
--   run() -> serves one HTTP request from stdin/stdout
--   db_helper_main(state_path, command_path) -> flock-guarded DB helper mode

local M = {}

local function dirname(path)
	return (path and path:match("^(.*)/[^/]*$")) or "."
end

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", [['"'"']]) .. "'"
end

local function read_all(path)
	local file = io.open(path, "rb")
	if not file then
		return nil
	end

	local contents = file:read("*a")
	file:close()
	return contents
end

local function write_all(path, contents)
	local file = assert(io.open(path, "wb"))
	file:write(contents or "")
	file:close()
end

local function status_line(status)
	if status == 302 then
		return "HTTP/1.1 302 Found"
	end
	if status == 404 then
		return "HTTP/1.1 404 Not Found"
	end
	if status == 500 then
		return "HTTP/1.1 500 Internal Server Error"
	end
	return "HTTP/1.1 200 OK"
end

local function content_type_for(path)
	local lower = tostring(path or ""):lower()
	if lower:match("%.js$") then
		return "application/javascript; charset=utf-8"
	end
	if lower:match("%.mjs$") then
		return "application/javascript; charset=utf-8"
	end
	if lower:match("%.css$") then
		return "text/css; charset=utf-8"
	end
	if lower:match("%.json$") then
		return "application/json; charset=utf-8"
	end
	if lower:match("%.svg$") then
		return "image/svg+xml"
	end
	if lower:match("%.wasm$") then
		return "application/wasm"
	end
	if lower:match("%.html?$") then
		return "text/html; charset=utf-8"
	end
	if lower:match("%.txt$") then
		return "text/plain; charset=utf-8"
	end
	return "text/plain; charset=utf-8"
end

local function file_exists(path)
	local file = io.open(path, "rb")
	if file then
		file:close()
		return true
	end
	return false
end

local function ensure_path(path, contents)
	if not file_exists(path) then
		write_all(path, contents or "")
	end
end

local function deep_copy(value)
	if type(value) ~= "table" then
		return value
	end

	local out = {}
	for key, entry in pairs(value) do
		out[deep_copy(key)] = deep_copy(entry)
	end
	return out
end

local function is_array(value)
	local count = 0
	for key in pairs(value) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false, 0
		end
		count = count + 1
	end

	for index = 1, count do
		if value[index] == nil then
			return false, 0
		end
	end

	return true, count
end

local function sorted_keys(value)
	local keys = {}
	for key in pairs(value) do
		keys[#keys + 1] = key
	end

	table.sort(keys, function(left, right)
		local left_type = type(left)
		local right_type = type(right)
		if left_type == right_type then
			return tostring(left) < tostring(right)
		end
		return left_type < right_type
	end)

	return keys
end

local function serialize_lua(value, indent)
	indent = indent or ""

	local value_type = type(value)
	if value_type == "nil" then
		return "nil"
	end
	if value_type == "number" or value_type == "boolean" then
		return tostring(value)
	end
	if value_type == "string" then
		return string.format("%q", value)
	end
	if value_type ~= "table" then
		error("cannot serialize type " .. value_type)
	end

	local array, count = is_array(value)
	local child_indent = indent .. "  "
	local parts = {}

	if array then
		for index = 1, count do
			parts[#parts + 1] = child_indent .. serialize_lua(value[index], child_indent) .. ","
		end
	else
		for _, key in ipairs(sorted_keys(value)) do
			parts[#parts + 1] = child_indent
				.. "["
				.. serialize_lua(key, child_indent)
				.. "] = "
				.. serialize_lua(value[key], child_indent)
				.. ","
		end
	end

	if #parts == 0 then
		return "{}"
	end

	return "{\n" .. table.concat(parts, "\n") .. "\n" .. indent .. "}"
end

local script_source = debug.getinfo(1, "S").source
local script_path = script_source:sub(1, 1) == "@" and script_source:sub(2) or script_source
local runtime_dir = dirname(script_path)
local root_dir = dirname(runtime_dir)
local payloads_root = root_dir .. "/payloads"
local payload_root = payloads_root .. "/current"
local dev_dir = root_dir .. "/.fuwa-dev"
local state_path = dev_dir .. "/state.lua"
local lock_path = state_path .. ".lock"
local reload_token_path = dev_dir .. "/reload-token"
local drafts_root = dev_dir .. "/drafts"
local default_db_path = dev_dir .. "/sqlite-local.db"
local lua_bin = os.getenv("LUA_BIN") or "lua5.4"

package.path = root_dir .. "/?.lua;" .. root_dir .. "/?/init.lua;" .. root_dir .. "/?/?.lua;" .. package.path

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local package_web = require("runtime.stdlib.compiler.package_web")
local browser_runtime = require("runtime.browser")
local host_caps = require("runtime.host.capabilities")
local runtime_db = require("runtime.db")
local trace = require("runtime.trace")
local log = require("runtime.log")

local runtime_preloads = {
	["runtime.stdlib.db"] = "runtime/stdlib/db.lua",
	["runtime.stdlib.result"] = "runtime/stdlib/result.lua",
	["runtime.stdlib.schema"] = "runtime/stdlib/schema.lua",
	["runtime.stdlib.view"] = "runtime/stdlib/view.lua",
	["runtime.stdlib.web"] = "runtime/stdlib/web.lua",
}

local shell_root = root_dir .. "/shell"
local vendor_root = root_dir .. "/vendor"

os.execute("mkdir -p " .. shell_quote(dev_dir))
ensure_path(state_path, "return {}\n")
ensure_path(lock_path, "")
ensure_path(reload_token_path, "")

local function dev_trace_sink(event)
	if type(event) ~= "table" then
		return
	end

	if event.kind == "request" then
		local status = event.status
		if status == nil and event.failed then
			status = 500
		end

		local parts = {
			"◀ request",
			tostring(event.method or "-"),
			tostring(event.path or "-"),
			"status=" .. tostring(status or "unknown"),
			"trace=" .. tostring(event.trace_id or "-"),
			string.format("%.1fms", tonumber(event.duration_ms or 0) or 0),
		}

		if event.failed then
			parts[#parts + 1] = "error=" .. log.serialize(event.error)
		end

		io.stderr:write(table.concat(parts, " "), "\n")
		io.stderr:flush()
		return
	end

	log.pretty_sink(event)
end

trace.set_sink(dev_trace_sink)

local function register_runtime_preloads()
	for module_name, relative_path in pairs(runtime_preloads) do
		local absolute_path = root_dir .. "/" .. relative_path
		package.preload[module_name] = function()
			local chunk, err = loadfile(absolute_path)
			assert(chunk, err)
			return chunk()
		end
	end
end

local function collect_find_output(root)
	local command = string.format("find %s -type f 2>/dev/null | sort", shell_quote(root))
	local pipe = assert(io.popen(command, "r"))
	local files = {}
	local prefix = root .. "/"

	for path in pipe:lines() do
		local relative = path:sub(#prefix + 1)
		local contents = read_all(path)
		if contents ~= nil then
			files[relative] = contents
		end
	end

	pipe:close()
	return files
end

local function render_reload_script(html)
	local script = table.concat({
		"<script>",
		"if (location.hostname === 'localhost') {",
		"  const es = new EventSource('/__dev/reload');",
		"  es.onmessage = () => location.reload();",
		"}",
		"</script>",
	}, "\n")

	local injected, count = html:gsub("</body>", script .. "</body>", 1)
	if count > 0 then
		return injected
	end

	return html .. script
end

local function has_dotdot_segment(path)
	for segment in tostring(path or ""):gmatch("[^/]+") do
		if segment == ".." then
			return true
		end
	end
	return false
end

-- Splits /<prefix>/<payload_id><inner_path>. Returns nil for ids that are not
-- filesystem-safe so route roots can never escape the payloads tree.
local function split_mount_route(path, prefix)
	local payload_id, inner_path = path:match("^/" .. prefix .. "/([^/]+)(/.*)$")
	if payload_id == nil then
		payload_id = path:match("^/" .. prefix .. "/([^/]+)/?$")
		inner_path = "/"
	end

	if payload_id == nil or payload_id:match("^[A-Za-z0-9_%-]+$") == nil then
		return nil, nil
	end

	return payload_id, inner_path
end

local function split_payload_route(path)
	return split_mount_route(path, "payload")
end

local function serve_static_asset(path)
	local contents = read_all(path)
	if contents == nil then
		return nil
	end

	return {
		status = 200,
		headers = {
			["Content-Type"] = content_type_for(path),
			["Content-Length"] = tostring(#contents),
			["Cache-Control"] = "no-cache",
			["Connection"] = "close",
		},
		body = contents,
	}
end

local function load_chunk(source, name)
	local chunk, err = load(source, "@" .. name)
	assert(chunk, err)
	return chunk()
end

local function resolve_db_provider(opts)
	opts = opts or {}
	if opts.db_provider ~= nil then
		return opts.db_provider
	end

	local provider_name = opts.db_provider_name or "sqlite_local"
	local provider_opts = deep_copy(opts.db_provider_opts or {})
	if provider_name == "sqlite_local" and provider_opts.path == nil and os.getenv("FUWA_DB_PATH") == nil then
		provider_opts.path = default_db_path
	end

	return runtime_db.new(provider_name, provider_opts)
end

local function load_state(path)
	local file = io.open(path, "rb")
	if not file then
		return { collections = {} }
	end

	local contents = file:read("*a")
	file:close()
	if not contents or contents == "" then
		return { collections = {} }
	end

	local chunk, err = load(contents, "@" .. path, "t", {})
	assert(chunk, err)
	local state = chunk()
	if type(state) ~= "table" then
		return { collections = {} }
	end

	state.collections = state.collections or {}
	return state
end

local function save_state(path, state)
	local temp_path = path .. ".tmp"
	write_all(temp_path, "return " .. serialize_lua(state))
	assert(os.rename(temp_path, path))
end

local function values_equal(left, right)
	if left == right then
		return true
	end
	if left == nil or right == nil then
		return false
	end
	return tostring(left) == tostring(right)
end

local function copy_rows(rows)
	local out = {}
	for index, row in ipairs(rows or {}) do
		out[index] = deep_copy(row)
	end
	return out
end

local function ensure_collection(state, name)
	state.collections = state.collections or {}
	local collection = state.collections[name]
	if type(collection) ~= "table" then
		collection = {}
		state.collections[name] = collection
	end

	collection.rows = collection.rows or {}
	if type(collection.next_id) ~= "number" then
		local max_id = 0
		for _, row in ipairs(collection.rows) do
			local row_id = tonumber(row.id)
			if row_id and row_id > max_id then
				max_id = row_id
			end
		end
		collection.next_id = max_id + 1
	end

	return collection
end

local function find_row_index(rows, id)
	for index, row in ipairs(rows) do
		if values_equal(row.id, id) then
			return index
		end
	end
	return nil
end

local function row_matches(row, where)
	for key, expected in pairs(where or {}) do
		if not values_equal(row[key], expected) then
			return false
		end
	end
	return true
end

local function response_ok(value)
	return { ok = true, value = value }
end

local function response_not_found(message)
	return {
		ok = false,
		err = {
			kind = "not_found",
			message = message or "row not found",
		},
	}
end

local function apply_db_command(state, command)
	if command.collection == nil then
		return {
			ok = false,
			err = {
				kind = "invalid_command",
				message = "Missing collection name",
			},
		}
	end

	local collection = ensure_collection(state, command.collection)
	local rows = collection.rows
	local op = command.op

	if op == "all" then
		return response_ok(copy_rows(rows))
	end

	if op == "find" then
		local index = find_row_index(rows, command.id)
		if not index then
			return response_not_found("row not found")
		end
		return response_ok(deep_copy(rows[index]))
	end

	if op == "find_by" then
		for _, row in ipairs(rows) do
			if row_matches(row, command.where or {}) then
				return response_ok(deep_copy(row))
			end
		end
		return response_not_found("row not found")
	end

	if op == "where" then
		local matched = {}
		local limit = tonumber(command.limit)
		for _, row in ipairs(rows) do
			if row_matches(row, command.where or {}) then
				matched[#matched + 1] = deep_copy(row)
				if limit and #matched >= limit then
					break
				end
			end
		end
		return response_ok(matched)
	end

	if op == "create" or op == "insert" then
		local row = deep_copy(command.data or {})
		if row.id == nil then
			row.id = collection.next_id
			collection.next_id = collection.next_id + 1
		else
			local row_id = tonumber(row.id)
			if row_id and row_id >= collection.next_id then
				collection.next_id = row_id + 1
			end
		end

		rows[#rows + 1] = row
		return response_ok(deep_copy(row))
	end

	if op == "update" then
		local index = find_row_index(rows, command.id)
		if not index then
			return response_not_found("row not found")
		end

		local row = rows[index]
		for key, value in pairs(command.data or {}) do
			row[key] = deep_copy(value)
		end
		row.id = row.id or command.id
		return response_ok(deep_copy(row))
	end

	if op == "delete" then
		local index = find_row_index(rows, command.id)
		if not index then
			return response_not_found("row not found")
		end

		local row = table.remove(rows, index)
		return response_ok(deep_copy(row))
	end

	return {
		ok = false,
		err = {
			kind = "unsupported_op",
			message = "Unsupported DB op: " .. tostring(op),
		},
	}
end

local function db_helper_main(state_file, command_file)
	local state = load_state(state_file)
	local command_chunk, command_err = loadfile(command_file, "t", {})
	assert(command_chunk, command_err)
	local command = command_chunk()
	if type(command) ~= "table" then
		command = {}
	end
	local response = apply_db_command(state, command)

	local write_state = command.op == "create" or command.op == "insert" or command.op == "update" or command.op == "delete"
	if write_state then
		save_state(state_file, state)
	end

	io.stdout:write(serialize_lua(response))
	io.stdout:flush()
end

local function make_db_bridge(command)
	return {
		await = function()
			return runtime_db.db_op(command)
		end
	}
end

local function make_set_html_capture()
	local captured = { value = nil }
	return captured, function(value)
		captured.value = value
	end
end

-- Draft overlay: files in overlay_root shadow files in root. Live edits are
-- written to the overlay only; the payload source tree stays untouched until
-- an explicit publish promotes them.
function M.collect_payload_files(root, overlay_root)
	local files = collect_find_output(root or payload_root)
	if overlay_root ~= nil then
		for relative, contents in pairs(collect_find_output(overlay_root)) do
			files[relative] = contents
		end
	end
	return files
end

function M.draft_overlay_dir(payload_id)
	local safe_id = tostring(payload_id or ""):match("^[A-Za-z0-9_%-]+$")
	if safe_id == nil then
		return nil
	end
	return drafts_root .. "/" .. safe_id
end

local function url_decode(value)
	value = tostring(value or "")
	value = value:gsub("+", " ")
	value = value:gsub("%%(%x%x)", function(hex)
		return string.char(tonumber(hex, 16))
	end)
	return value
end

local function parse_form_body(body)
	local form = {}
	for key, value in (tostring(body or "") .. "&"):gmatch("([^=&]+)=([^&]*)&") do
		form[url_decode(key)] = url_decode(value)
	end
	return form
end

local function validate_draft_path(relative_path)
	local path = tostring(relative_path or "")
	if path == "" or #path > 512 then
		return nil
	end
	if path:match("^[A-Za-z0-9_%-./]+$") == nil then
		return nil
	end
	if path:sub(1, 1) == "/" or path:sub(-1) == "/" then
		return nil
	end
	for segment in path:gmatch("[^/]+") do
		if segment == ".." or segment == "." then
			return nil
		end
	end
	return path
end

local function json_response(status, body)
	return {
		status = status,
		headers = {
			["Content-Type"] = "application/json; charset=utf-8",
			["Content-Length"] = tostring(#body),
			["Cache-Control"] = "no-cache",
			["Connection"] = "close",
		},
		body = body,
	}
end

function M.build_draft_write_response(payload_id, body)
	local overlay_dir = M.draft_overlay_dir(payload_id)
	if overlay_dir == nil then
		return json_response(404, '{"ok":false,"err":"invalid_payload_id"}')
	end

	local form = parse_form_body(body)
	local draft_path = validate_draft_path(form.path)
	if draft_path == nil then
		return json_response(400, '{"ok":false,"err":"invalid_path"}')
	end

	local target = overlay_dir .. "/" .. draft_path
	os.execute("mkdir -p " .. shell_quote(dirname(target)))
	write_all(target, form.contents or "")

	local escaped = draft_path:gsub("[\\\"]", "\\%0")
	return json_response(200, '{"ok":true,"path":"' .. escaped .. '"}')
end

function M.build_draft_discard_response(payload_id, body)
	local overlay_dir = M.draft_overlay_dir(payload_id)
	if overlay_dir == nil then
		return json_response(404, '{"ok":false,"err":"invalid_payload_id"}')
	end

	local form = parse_form_body(body)
	if form.path ~= nil and form.path ~= "" then
		local draft_path = validate_draft_path(form.path)
		if draft_path == nil then
			return json_response(400, '{"ok":false,"err":"invalid_path"}')
		end
		os.remove(overlay_dir .. "/" .. draft_path)
	else
		-- overlay_dir is derived from a sanitized id under drafts_root, so the
		-- recursive delete cannot escape the drafts area.
		os.execute("rm -rf " .. shell_quote(overlay_dir))
	end

	return json_response(200, '{"ok":true}')
end

local function collect_stdlib_sources()
	local sources = {}
	for _, relative_path in pairs(runtime_preloads) do
		local contents = read_all(root_dir .. "/" .. relative_path)
		if contents ~= nil then
			sources[relative_path] = contents
		end
	end
	return sources
end

-- Browser runtime bundle: compiled run files plus the stdlib VFS the
-- Wasmoon worker needs. Served as JSON at /runtime/<payload_id>/bundle.json.
function M.build_bundle_response(payload_id, opts)
	opts = opts or {}
	local safe_id = tostring(payload_id or ""):match("^[A-Za-z0-9_%-]+$")
	if safe_id == nil then
		return {
			status = 404,
			headers = {
				["Content-Type"] = "text/plain; charset=utf-8",
				["Content-Length"] = "9",
				["Connection"] = "close",
			},
			body = "Not found",
		}
	end

	local overlay_root = nil
	if opts.draft then
		overlay_root = drafts_root .. "/" .. safe_id
	end
	local source_files = M.collect_payload_files(payloads_root .. "/" .. safe_id, overlay_root)
	local bundle = browser_runtime.bundle.build(source_files, collect_stdlib_sources())
	local body = browser_runtime.bundle.to_json(bundle)

	return {
		status = bundle.ok and 200 or 500,
		headers = {
			["Content-Type"] = "application/json; charset=utf-8",
			["Content-Length"] = tostring(#body),
			["Cache-Control"] = "no-cache",
			["Connection"] = "close",
		},
		body = body,
	}
end

function M.build_response(root, method, path, body, opts)
	opts = opts or {}
	local db_provider = resolve_db_provider(opts)
	local allow_host = opts.allow_host == true
	runtime_db.set_provider(db_provider)

	return trace.span("request", {
		method = method,
		path = path,
	}, function(request_span)
		register_runtime_preloads()

		local source_files = M.collect_payload_files(root or payload_root, opts.overlay_root)
		local build = package_web.build(source_files)

		if diagnostics.has_errors(build.diagnostics) then
			local message = diagnostics.format(build.diagnostics)
			request_span:set("status", 500)
			request_span:set("errors", #build.diagnostics)
			return {
				status = 500,
				headers = {
					["Content-Type"] = "text/plain; charset=utf-8",
					["Content-Length"] = tostring(#message),
					["Connection"] = "close",
				},
				body = message,
			}
		end

		local compiled_modules = {}
		for name, source in pairs(build.run_files) do
			if name:sub(-4) == ".lua" then
				compiled_modules[name:sub(1, -5):gsub("/", ".")] = source
			end
		end

		local original_host_loaded = package.loaded["host"]
		local original_host_preloaded = package.preload["host"]
		package.loaded["host"] = nil
		if allow_host then
			package.preload["host"] = function()
				return host_caps.new({
					root_dir = root_dir,
					db_provider = db_provider,
				})
			end
		else
			package.preload["host"] = nil
		end

		local original_loaded = {}
		local original_preloaded = {}
		for module_name, source in pairs(compiled_modules) do
			original_loaded[module_name] = package.loaded[module_name]
			original_preloaded[module_name] = package.preload[module_name]
			package.loaded[module_name] = nil
			package.preload[module_name] = function()
				return load_chunk(source, module_name)
			end
		end

		local captured, set_html = make_set_html_capture()
		_G.__fuwa_is_request = true
		_G.__fuwa_print = function(...)
			return ...
		end
		_G.__fuwa_db_op = make_db_bridge
		_G.set_html = set_html

		local html = trace.span("render", {
			method = method,
			path = path,
		}, function(render_span)
			local ok, result = pcall(function()
				load_chunk(assert(build.run_files["main.lua"], "missing main.lua"), "main.lua")
				local handle_request = assert(_G.handle_request, "main.lua did not define handle_request")
				local rendered = handle_request(method, path, body or "")
				local output = tostring(rendered or captured.value or "")
				-- Dev reload only targets tenant documents. The shell host page
				-- must not full-page reload on payload disk writes — saves refresh
				-- the preview surgically through the #ide-preview-refresh token.
				if method == "GET" and not allow_host then
					output = render_reload_script(output)
				end
				return output
			end)

			package.loaded["host"] = original_host_loaded
			package.preload["host"] = original_host_preloaded
			for module_name, _ in pairs(compiled_modules) do
				package.loaded[module_name] = original_loaded[module_name]
				package.preload[module_name] = original_preloaded[module_name]
			end

			if not ok then
				error(tostring(result), 0)
			end

			render_span:set("bytes", #result)
			return result
		end)

		request_span:set("status", 200)
		request_span:set("bytes", #html)

		return {
			status = 200,
			headers = {
				["Content-Type"] = "text/html; charset=utf-8",
				["Content-Length"] = tostring(#html),
				["Connection"] = "close",
			},
			body = html,
		}
	end)
end

local function read_request()
	local first_line = io.read("*l")
	if not first_line then
		return nil
	end

	first_line = first_line:gsub("\r$", "")
	if first_line == "" then
		return nil
	end

	local method, path = first_line:match("^(%u+)%s+([^%s]+)%s+HTTP/[%d%.]+$")
	if not method then
		error("Malformed request line: " .. first_line)
	end

	local headers = {}
	while true do
		local line = io.read("*l")
		if not line then
			break
		end

		line = line:gsub("\r$", "")
		if line == "" then
			break
		end

		local name, value = line:match("^([^:]+):%s*(.*)$")
		if name then
			headers[name:lower()] = value
		end
	end

	local content_length = tonumber(headers["content-length"] or "0") or 0
	local body = ""
	if content_length > 0 then
		body = io.read(content_length) or ""
	end

	return {
		method = method,
		path = path,
		headers = headers,
		body = body,
	}
end

local function write_http_response(response)
	io.stdout:write(status_line(response.status), "\r\n")
	for name, value in pairs(response.headers or {}) do
		io.stdout:write(name, ": ", value, "\r\n")
	end
	io.stdout:write("\r\n")
	io.stdout:write(response.body or "")
	io.stdout:flush()
end

local function poll_reload_token(token_path, timeout_seconds)
	local function file_signature(path)
		local command = string.format("stat -c %%y %s 2>/dev/null", shell_quote(path))
		local pipe = io.popen(command, "r")
		if not pipe then
			return ""
		end

		local signature = pipe:read("*a") or ""
		pipe:close()
		return signature:gsub("%s+$", "")
	end

	local last_signature = file_signature(token_path)
	local started_at = os.clock()

	while os.clock() - started_at < timeout_seconds do
		os.execute("sleep 0.25")
		local current_signature = file_signature(token_path)
		if current_signature ~= last_signature then
			return true
		end
	end

	return false
end

local function handle_reload_request()
	local headers = {
		["Content-Type"] = "text/event-stream",
		["Cache-Control"] = "no-cache",
		["Connection"] = "keep-alive",
	}

	io.stdout:write("HTTP/1.1 200 OK\r\n")
	for name, value in pairs(headers) do
		io.stdout:write(name, ": ", value, "\r\n")
	end
	io.stdout:write("\r\n")
	io.stdout:write(": connected\n\n")
	io.stdout:flush()

	if poll_reload_token(reload_token_path, 30) then
		io.stdout:write("data: reload\n\n")
		io.stdout:flush()
	end
end

function M.run()
	io.stdout:setvbuf("no")
	ensure_path(reload_token_path, "")

	local request = read_request()
	if not request then
		return
	end

	if request.path:match("^/shell/hooks/") then
		local relative_path = request.path:gsub("^/shell/", "", 1)
		local asset = serve_static_asset(shell_root .. "/" .. relative_path)
		if asset then
			write_http_response(asset)
		else
			write_http_response({
				status = 404,
				headers = {
					["Content-Type"] = "text/plain; charset=utf-8",
					["Content-Length"] = "9",
					["Connection"] = "close",
				},
				body = "Not found",
			})
		end
		return
	end

	if request.path:match("^/vendor/") then
		local relative_path = request.path:gsub("^/vendor/", "", 1)
		local asset = serve_static_asset(vendor_root .. "/" .. relative_path)
		if asset then
			write_http_response(asset)
		else
			write_http_response({
				status = 404,
				headers = {
					["Content-Type"] = "text/plain; charset=utf-8",
					["Content-Length"] = "9",
					["Connection"] = "close",
				},
				body = "Not found",
			})
		end
		return
	end

	local mount_kind = request.path:match("^/(payload)/") or request.path:match("^/(preview)/")
	local payload_id, inner_path
	if mount_kind then
		payload_id, inner_path = split_mount_route(request.path, mount_kind)
	end

	if payload_id and inner_path and has_dotdot_segment(inner_path) then
		write_http_response({
			status = 404,
			headers = {
				["Content-Type"] = "text/plain; charset=utf-8",
				["Content-Length"] = "9",
				["Connection"] = "close",
			},
			body = "Not found",
		})
		return
	end

	if payload_id and inner_path and inner_path ~= "/" and inner_path:match("%.[^/]+$") and not inner_path:match("%.fuwa$") then
		local asset = nil
		if mount_kind == "preview" then
			asset = serve_static_asset(drafts_root .. "/" .. payload_id .. inner_path)
		end
		if asset == nil then
			asset = serve_static_asset(payloads_root .. "/" .. payload_id .. inner_path)
		end
		if asset then
			write_http_response(asset)
		else
			write_http_response({
				status = 404,
				headers = {
					["Content-Type"] = "text/plain; charset=utf-8",
					["Content-Length"] = "9",
					["Connection"] = "close",
				},
				body = "Not found",
			})
		end
		return
	end

	if request.path == "/__dev/reload" then
		handle_reload_request()
		return
	end

	local draft_discard_id = request.path:match("^/draft/([^/]+)/discard$")
	if draft_discard_id and request.method == "POST" then
		write_http_response(M.build_draft_discard_response(draft_discard_id, request.body))
		return
	end

	local draft_write_id = request.path:match("^/draft/([^/]+)$")
	if draft_write_id and request.method == "POST" then
		write_http_response(M.build_draft_write_response(draft_write_id, request.body))
		return
	end

	local bundle_route, bundle_query = request.path:match("^([^?]+)%??(.*)$")
	local bundle_payload_id = tostring(bundle_route or ""):match("^/runtime/([^/]+)/bundle%.json$")
	if bundle_payload_id and request.method == "GET" then
		write_http_response(M.build_bundle_response(bundle_payload_id, {
			draft = tostring(bundle_query or ""):match("draft=1") ~= nil,
		}))
		return
	end

	if request.path == "/runtime/tenant.html" and request.method == "GET" then
		local tenant_html = browser_runtime.bootstrap.build_runtime_srcdoc()
		write_http_response({
			status = 200,
			headers = {
				["Content-Type"] = "text/html; charset=utf-8",
				["Content-Length"] = tostring(#tenant_html),
				["Cache-Control"] = "no-cache",
				["Connection"] = "close",
			},
			body = tenant_html,
		})
		return
	end

	local response
	if mount_kind then
		if payload_id == nil then
			write_http_response({
				status = 404,
				headers = {
					["Content-Type"] = "text/plain; charset=utf-8",
					["Content-Length"] = "9",
					["Connection"] = "close",
				},
				body = "Not found",
			})
			return
		end

		if request.path:match("^/" .. mount_kind .. "/[^/]+$") and request.method == "GET" then
			write_http_response({
				status = 302,
				headers = {
					["Location"] = request.path .. "/",
					["Connection"] = "close",
				},
				body = "",
			})
			return
		end

		local opts = {
			db_provider_name = "sqlite_local",
		}
		if mount_kind == "preview" then
			opts.overlay_root = drafts_root .. "/" .. payload_id
		end

		response = M.build_response(
			payloads_root .. "/" .. payload_id,
			request.method,
			inner_path,
			request.body,
			opts
		)

		-- Payload markup hardcodes absolute /payload/<id>/ routes. Inside a
		-- draft preview those must stay on the draft surface, otherwise htmx
		-- interactions would run published code against a draft document.
		if mount_kind == "preview"
			and response.body
			and tostring((response.headers or {})["Content-Type"] or ""):match("text/html") then
			local pattern_id = payload_id:gsub("%-", "%%-")
			response.body = response.body:gsub("/payload/" .. pattern_id .. "/", "/preview/" .. payload_id .. "/")
			response.headers["Content-Length"] = tostring(#response.body)
		end
	else
		response = M.build_response(shell_root, request.method, request.path, request.body, {
			allow_host = true,
		})
	end

	write_http_response(response)
end

function M.db_helper_main(state_file, command_file)
	db_helper_main(state_file, command_file)
end

local function running_as_script()
	if type(arg) ~= "table" then
		return false
	end

	local script_arg = tostring(arg[0] or ""):gsub("\\", "/")
	return script_arg:match("runtime/fuwa%-dev%.lua$") ~= nil
end

if running_as_script() then
	if arg[1] == "--db-op" then
		db_helper_main(arg[2], arg[3])
	else
		M.run()
	end
end

return M
