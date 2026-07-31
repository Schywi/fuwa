-- runtime/openresty/deploy/preview_handler.lua
-- GET /p/{slug}/* — serve deployed payload wrapped in public shell,
-- or the marketing landing page at /p/{slug}/ (root).

local fuwa_dev = require("runtime.fuwa-dev")
local store = require("runtime.openresty.deploy.store")
local public_shell = require("runtime.openresty.deploy.public_shell")
local preview_db_bridge = require("runtime.openresty.preview.db_bridge")
local request_body = require("runtime.openresty.request_body")
require("runtime.openresty.tracing.sink").install()
local trace = require("runtime.trace")

local function load_chunk(source, name)
	local chunk, err = load(source, "@" .. name)
	assert(chunk, err)
	return chunk()
end

-- Run pre-compiled Lua files: inject modules, load entry, call handle_request.
local function run_compiled(compiled_files, entry, method, path, body, db_bridge)
	-- Register stdlib preloads (same as fuwa-dev.lua does)
	local runtime_preloads = {
		["runtime.stdlib.db"] = "runtime/stdlib/db.lua",
		["runtime.stdlib.result"] = "runtime/stdlib/result.lua",
		["runtime.stdlib.schema"] = "runtime/stdlib/schema.lua",
		["runtime.stdlib.view"] = "runtime/stdlib/view.lua",
		["runtime.stdlib.web"] = "runtime/stdlib/web.lua",
	}
	local root_dir = fuwa_dev.ROOT_DIR or "."
	for module_name, relative_path in pairs(runtime_preloads) do
		local absolute_path = root_dir .. "/" .. relative_path
		package.preload[module_name] = function()
			local chunk, err = loadfile(absolute_path)
			assert(chunk, err)
			return chunk()
		end
	end

	-- Install compiled user modules
	local original_loaded = {}
	local original_preloaded = {}
	for name, source in pairs(compiled_files) do
		local mod_name = name:gsub("/", "."):gsub("%.lua$", "")
		original_loaded[mod_name] = package.loaded[mod_name]
		original_preloaded[mod_name] = package.preload[mod_name]
		package.loaded[mod_name] = nil
		package.preload[mod_name] = function()
			return load_chunk(source, mod_name)
		end
	end

	-- Disable host module for public previews (no shell access)
	local original_host_loaded = package.loaded["host"]
	local original_host_preloaded = package.preload["host"]
	package.loaded["host"] = nil
	package.preload["host"] = nil

	-- Set up runtime globals
	local captured = { value = nil }
	_G.__fuwa_is_request = true
	_G.__fuwa_print = function(...) return ... end
	_G.__fuwa_db_op = db_bridge
	_G.set_html = function(value)
		captured.value = value
	end

	local ok, result = pcall(function()
		load_chunk(assert(compiled_files[entry], "missing entry: " .. entry), entry)
		local handle_request = assert(_G.handle_request, "entry did not define handle_request")
		return tostring(handle_request(method, path, body or "") or captured.value or "")
	end)

	-- Restore module state
	package.loaded["host"] = original_host_loaded
	package.preload["host"] = original_host_preloaded
	for mod_name, _ in pairs(compiled_files) do
		local name = mod_name:gsub("/", "."):gsub("%.lua$", "")
		package.loaded[name] = original_loaded[name]
		package.preload[name] = original_preloaded[name]
	end

	if not ok then
		return nil, tostring(result)
	end

	return result
end

-- Main handler
local uri = ngx.var.uri
local query_args = ngx.req.get_uri_args()

-- Parse /p/{slug}/{*path}
local slug, subpath = uri:match("^/p/([^/]+)(/.*)$")
if not slug then
	slug = uri:match("^/p/([^/]+)/?$")
	subpath = "/"
end

if not slug or slug == "" then
	ngx.status = 404
	ngx.say("Not found")
	return
end

local method = ngx.req.get_method()
local body = request_body.read()

-- Load deployment
local record = store.load(slug)
if not record then
	ngx.status = 404
	ngx.say("Deployment not found: " .. slug)
	return
end

local app_root = type(query_args.app) == "string" and query_args.app == "1"

-- Route: root path → marketing landing page unless the iframe explicitly asks
-- for the deployed app root.
if (subpath == "/" or subpath == "" or subpath == nil) and not app_root then
	return trace.span("preview", {
		slug = slug,
		kind = "landing",
	}, function(span)
		local mount_path = "/p/" .. slug
		local response = fuwa_dev.build_response(
			"payloads/preview-landing",
			method,
			"/",
			body,
			{ db_provider_name = "memory" }
		)
		span:set("status", response.status)
		span:set("bytes", response.body and #response.body or 0)

		ngx.status = response.status
		for k, v in pairs(response.headers or {}) do
			if k ~= "Connection" then
				ngx.header[k] = v
			end
		end
		if response.body then
			local rebased = response.body:gsub('src="/p/current/app"', 'src="' .. mount_path .. '/?app=1"', 1)
			ngx.print(rebased)
		end
	end)
end

-- Route: serve deployed app in iframe
return trace.span("preview", {
	slug = slug,
	path = subpath,
	kind = "app",
}, function(span)
	local mount_path = "/p/" .. slug
	local request_path = subpath
	if app_root and (subpath == "/" or subpath == "" or subpath == nil) then
		request_path = "/"
	end

	-- Static asset within deployment (has file extension)
	if request_path ~= "/" and request_path:match("%.[^/]+$") and not request_path:match("%.fuwa$") then
		local filename = request_path:match("^/(.+)$") or request_path
		local content = record.compiled_files[filename]
		if not content then
			span:set("status", 404)
			ngx.status = 404
			ngx.say("Asset not found")
			return
		end
		local ct = "text/plain; charset=utf-8"
		if filename:match("%.js$") or filename:match("%.mjs$") then
			ct = "application/javascript; charset=utf-8"
		elseif filename:match("%.css$") then
			ct = "text/css; charset=utf-8"
		elseif filename:match("%.json$") then
			ct = "application/json; charset=utf-8"
		elseif filename:match("%.svg$") then
			ct = "image/svg+xml"
		elseif filename:match("%.wasm$") then
			ct = "application/wasm"
		elseif filename:match("%.html?$") then
			ct = "text/html; charset=utf-8"
		end
		span:set("status", 200)
		span:set("bytes", #content)
		ngx.header.content_type = ct
		ngx.print(content)
		return
	end

	-- Run compiled Lua app
	local html, err = run_compiled(
		record.compiled_files,
		record.entry,
		method,
		request_path,
		body,
		preview_db_bridge.new({ slug = slug })
	)

	if not html then
		span:set("status", 500)
		ngx.status = 500
		ngx.say("Lua error: " .. tostring(err))
		return
	end

	-- Wrap in public shell (standalone HTML for iframe)
	local wrapped = public_shell.wrap_html(html, mount_path, mount_path .. "/?app=1")

	span:set("status", 200)
	span:set("bytes", #wrapped)

	ngx.header.content_type = "text/html; charset=utf-8"
	ngx.header.x_frame_options = "SAMEORIGIN"
	ngx.print(wrapped)
end)
