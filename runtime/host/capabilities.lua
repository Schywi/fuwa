local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local package_web = require("runtime.stdlib.compiler.package_web")
local web = require("runtime.stdlib.web")
local db = require("runtime.db")

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

local function collect_files(root)
	local command = string.format("find %s -type f | sort", shell_quote(root))
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

local function load_chunk(source, name)
	local chunk, err = load(source, "@" .. name)
	assert(chunk, err)
	return chunk()
end

local function escape_html(value)
	local text = tostring(value or "")
	text = text:gsub("&", "&amp;")
	text = text:gsub("<", "&lt;")
	text = text:gsub(">", "&gt;")
	text = text:gsub('"', "&quot;")
	text = text:gsub("'", "&#39;")
	return text
end

local function build_preview_frame(slot, html)
	return table.concat({
		'<iframe class="shell-preview-frame"',
		' data-host-slot="' .. escape_html(slot) .. '"',
		' sandbox="allow-scripts allow-forms"',
		' title="Payload preview"',
		' srcdoc="' .. escape_html(html) .. '"',
		'></iframe>',
	}, "")
end

local function sandbox_modules(module_names, fn)
	local loaded = {}
	local preloaded = {}

	for _, name in ipairs(module_names) do
		loaded[name] = package.loaded[name]
		preloaded[name] = package.preload[name]
		package.loaded[name] = nil
		package.preload[name] = nil
	end

	local ok, result = pcall(fn)

	for _, name in ipairs(module_names) do
		package.loaded[name] = loaded[name]
		package.preload[name] = preloaded[name]
	end

	if not ok then
		return nil, result
	end

	return result
end

local function preload_runtime_module(root_dir, module_name)
	local module_path = root_dir .. "/" .. module_name:gsub("%.", "/") .. ".lua"
	return function()
		local chunk, err = loadfile(module_path)
		assert(chunk, err)
		return chunk()
	end
end

local function render_payload(slot, root_dir, payload_root, payload_id, opts)
	local payload_path = payload_root .. "/" .. payload_id
	local source_files = collect_files(payload_path)
	local build = package_web.build(source_files)

	if diagnostics.has_errors(build.diagnostics) then
		return nil, web.dev_error_html({
			_type = "error",
			err = {
				kind = "payload_error",
				message = diagnostics.format(build.diagnostics),
			},
			action = "host.mount_payload",
			line = 1,
			expr = payload_id,
		})
	end

	local compiled_modules = {}
	for name, source in pairs(build.run_files) do
		if name:sub(-4) == ".lua" then
			compiled_modules[name:sub(1, -5):gsub("/", ".")] = source
		end
	end

	local captured = { value = nil }
	local payload_db = db.new(opts.db_provider_name or "memory", opts.db_provider_opts or {})
	local payload_html, err = sandbox_modules({ "host" }, function()
		local original_print = _G.__fuwa_print
		local original_db_op = _G.__fuwa_db_op
		local original_is_request = _G.__fuwa_is_request
		local original_set_html = _G.set_html
		local original_package_path = package.path
		local original_package_cpath = package.cpath
		local original_loaded = {}
		local original_preloaded = {}
		local runtime_modules = {
			"runtime.stdlib.db",
			"runtime.stdlib.result",
			"runtime.stdlib.schema",
			"runtime.stdlib.view",
			"runtime.stdlib.web",
		}

		for module_name, source in pairs(compiled_modules) do
			original_loaded[module_name] = package.loaded[module_name]
			original_preloaded[module_name] = package.preload[module_name]
			package.loaded[module_name] = nil
			package.preload[module_name] = function()
				return load_chunk(source, module_name)
			end
		end

		for _, module_name in ipairs(runtime_modules) do
			original_loaded[module_name] = package.loaded[module_name]
			original_preloaded[module_name] = package.preload[module_name]
			package.loaded[module_name] = nil
			package.preload[module_name] = preload_runtime_module(root_dir, module_name)
		end

		package.path = ""
		package.cpath = ""

		_G.__fuwa_print = function()
			return nil
		end
		_G.__fuwa_db_op = function(command)
			return {
				await = function()
					return payload_db:op(command)
				end,
			}
		end
		_G.__fuwa_is_request = false
		_G.set_html = function(value)
			captured.value = value
		end

		local ok, run_err = pcall(function()
			load_chunk(assert(build.run_files["main.lua"], "missing main.lua"), "main.lua")
		end)

		for module_name, _ in pairs(compiled_modules) do
			package.loaded[module_name] = original_loaded[module_name]
			package.preload[module_name] = original_preloaded[module_name]
		end

		for _, module_name in ipairs(runtime_modules) do
			package.loaded[module_name] = original_loaded[module_name]
			package.preload[module_name] = original_preloaded[module_name]
		end

		_G.__fuwa_print = original_print
		_G.__fuwa_db_op = original_db_op
		_G.__fuwa_is_request = original_is_request
		_G.set_html = original_set_html
		package.path = original_package_path
		package.cpath = original_package_cpath

		if not ok then
			error(tostring(run_err), 0)
		end

		return tostring(captured.value or "")
	end)

	if payload_html == nil then
		return nil, web.dev_error_html({
			_type = "error",
			err = {
				kind = "payload_runtime_error",
				message = tostring(err or "Payload mount failed"),
			},
			action = "host.mount_payload",
			line = 1,
			expr = payload_id,
		})
	end

	return build_preview_frame(slot, payload_html)
end

function M.new(opts)
	opts = opts or {}
	local script_source = debug.getinfo(1, "S").source
	local script_path = script_source:sub(1, 1) == "@" and script_source:sub(2) or script_source
	local root_dir = opts.root_dir
	if root_dir == nil then
		root_dir = dirname(dirname(dirname(script_path)))
	end

	local payload_root = opts.payload_root or root_dir .. "/payloads"

	local instance = {
		__name = "host",
		__root = root_dir,
		__payload_root = payload_root,
	}

	function instance.mount_payload(slot, payload_id)
		slot = tostring(slot or "preview")
		payload_id = tostring(payload_id or "current")

		local html, err = render_payload(slot, root_dir, payload_root, payload_id, opts)
		if html ~= nil then
			return html
		end

		return err
	end

	return instance
end

return M
