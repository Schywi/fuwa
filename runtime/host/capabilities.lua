local trace = require("runtime.trace")
local package_web = require("runtime.stdlib.compiler.package_web")
local compiler_diagnostics = require("runtime.stdlib.compiler.diagnostics")
local util = require("runtime.util")

local M = {}

local function validate_relative_path(relative_path)
	if type(relative_path) ~= "string" or relative_path == "" then
		return nil
	end

	if relative_path:sub(1, 1) == "/" then
		return nil
	end

	if relative_path:find("%.%.", 1, true) then
		return nil
	end

	if not relative_path:match("^[%w_%.%-%/]+$") then
		return nil
	end

	return relative_path
end

local function payload_dir(payload_root, payload_id)
	return payload_root .. "/" .. payload_id
end

local function payload_file_path(payload_root, payload_id, relative_path)
	return payload_dir(payload_root, payload_id) .. "/" .. relative_path
end

local function count_entries(map)
	local total = 0
	for _ in pairs(map or {}) do
		total = total + 1
	end
	return total
end

local function collect_payload_sources(instance, payload_id)
	local root = payload_dir(instance.__payload_root, payload_id)
	local source_files = {}
	for _, relative_path in ipairs(util.list_files(root)) do
		local contents = util.read_all(root .. "/" .. relative_path)
		if contents ~= nil then
			source_files[relative_path] = contents
		end
	end
	return source_files
end

local function build_preview_frame(slot, payload_id, src)
	return table.concat({
		'<iframe class="shell-preview-frame"',
		' data-host-slot="' .. util.escape_html(slot) .. '"',
		' sandbox="allow-scripts allow-forms allow-same-origin"',
		' title="' .. util.escape_html(util.humanize_payload_id(payload_id)) .. '"',
		' src="' .. util.escape_html(src) .. '"',
		'></iframe>',
	}, "")
end

local function error_frame(slot, payload_id, message)
	return table.concat({
		'<div class="shell-preview-error"',
		' data-host-slot="' .. util.escape_html(slot) .. '"',
		' data-payload-id="' .. util.escape_html(payload_id) .. '"',
		'>',
		util.escape_html(message),
		"</div>",
	}, "")
end

local function render_mount(instance, slot, payload_id)
	return trace.span("host.mount_payload", {
		slot = slot,
		payload_id = payload_id,
	}, function(span)
		local normalized_id = util.validate_payload_id(payload_id or instance.__active_payload_id or "current")
		if normalized_id == nil then
			span:set("status", 400)
			span:set("ok", false)
			span:set("result", "invalid_payload_id")
			return error_frame(slot, tostring(payload_id or ""), "Invalid payload id")
		end

		local payload_root = payload_dir(instance.__payload_root, normalized_id)
		local app_path = payload_root .. "/app.fuwa"
		if not util.file_exists(app_path) then
			span:set("status", 404)
			span:set("ok", false)
			span:set("result", "missing_payload")
			span:set("app_path", app_path)
			return error_frame(slot, normalized_id, "Payload not found")
		end

		local payload_url = "/payload/" .. normalized_id .. "/"
		instance.__active_slot = slot
		instance.__active_payload_id = normalized_id
		span:set("status", 200)
		span:set("ok", true)
		span:set("result", "ok")
		span:set("bootstrap", "route")
		span:set("route", payload_url)
		return build_preview_frame(slot, normalized_id, payload_url)
	end)
end

local function list_payload_files(instance, payload_id)
	local normalized_id = util.validate_payload_id(payload_id or instance.__active_payload_id or "current")
	if normalized_id == nil then
		return nil
	end

	return util.list_files(payload_dir(instance.__payload_root, normalized_id))
end

local function read_payload_file(instance, payload_id, relative_path)
	local normalized_id = util.validate_payload_id(payload_id or instance.__active_payload_id or "current")
	local normalized_path = validate_relative_path(relative_path)
	if normalized_id == nil or normalized_path == nil then
		return nil
	end

	return util.read_all(payload_file_path(instance.__payload_root, normalized_id, normalized_path))
end

local function write_payload_file(instance, payload_id, relative_path, contents)
	local normalized_id = util.validate_payload_id(payload_id or instance.__active_payload_id or "current")
	local normalized_path = validate_relative_path(relative_path)
	if normalized_id == nil then
		return {
			ok = false,
			err = {
				kind = "invalid_payload_id",
				message = "Invalid payload id",
			},
		}
	end

	if normalized_path == nil then
		return {
			ok = false,
			err = {
				kind = "invalid_path",
				message = "Invalid payload file path",
			},
		}
	end

	local path = payload_file_path(instance.__payload_root, normalized_id, normalized_path)
	os.execute("mkdir -p " .. util.shell_quote(util.dirname(path)))
	util.write_all(path, contents or "")

	-- Publishing supersedes any live draft of the same file: the draft overlay
	-- (.fuwa-dev/drafts) only exists to keep unsaved edits out of the payload
	-- source tree, so a promoted file's draft copy is cleared here.
	os.remove(instance.__root .. "/.fuwa-dev/drafts/" .. normalized_id .. "/" .. normalized_path)

	return {
		ok = true,
		value = {
			path = normalized_path,
			payload_id = normalized_id,
		},
	}
end

local function describe_payload(instance, payload_id)
	local normalized_id = util.validate_payload_id(payload_id or instance.__active_payload_id or "current")
	if normalized_id == nil then
		return nil
	end

	local root = payload_dir(instance.__payload_root, normalized_id)
	local files = util.list_files(root)

	return {
		id = normalized_id,
		label = util.humanize_payload_id(normalized_id),
		path = root,
		route = "/payload/" .. normalized_id .. "/",
		exists = util.file_exists(root .. "/app.fuwa"),
		files = files,
		file_count = #files,
	}
end

local function compile_payload(instance, payload_id)
	return trace.span("host.compile_payload", {
		payload_id = payload_id,
	}, function(span)
		local normalized_id = util.validate_payload_id(payload_id or instance.__active_payload_id or "current")
		if normalized_id == nil then
			span:set("ok", false)
			span:set("result", "invalid_payload_id")
			return {
				ok = false,
				err = {
					kind = "invalid_payload_id",
					message = "Invalid payload id",
				},
			}
		end

		local build = package_web.build(collect_payload_sources(instance, normalized_id))
		local has_errors = compiler_diagnostics.has_errors(build.diagnostics)
		local output_lines = {
			"$ package_web.build " .. normalized_id,
		}

		if has_errors then
			output_lines[#output_lines + 1] = "Build failed"
			output_lines[#output_lines + 1] = compiler_diagnostics.format(build.diagnostics)
		else
			output_lines[#output_lines + 1] = "Build ok"
			output_lines[#output_lines + 1] = "Run files: " .. tostring(count_entries(build.run_files))
			output_lines[#output_lines + 1] = "Preview route: /payload/" .. normalized_id .. "/"
		end

		span:set("ok", not has_errors)
		span:set("result", has_errors and "diagnostics" or "ok")
		span:set("diagnostics", #build.diagnostics)
		span:set("run_files", count_entries(build.run_files))

		return {
			ok = true,
			value = {
				payload_id = normalized_id,
				success = not has_errors,
				status = has_errors and "error" or "ok",
				run_files = build.run_files,
				diagnostics = build.diagnostics,
				output = table.concat(output_lines, "\n"),
			},
		}
	end)
end

function M.new(opts)
	opts = opts or {}
	local script_source = debug.getinfo(1, "S").source
	local script_path = script_source:sub(1, 1) == "@" and script_source:sub(2) or script_source
	local root_dir = opts.root_dir
	if root_dir == nil then
		root_dir = util.dirname(util.dirname(util.dirname(script_path)))
	end

	local payload_root = opts.payload_root or root_dir .. "/payloads"

	local instance = {
		__name = "host",
		__root = root_dir,
		__payload_root = payload_root,
		__active_slot = nil,
		__active_payload_id = nil,
	}

	function instance.mount_payload(slot, payload_id)
		slot = tostring(slot or "preview")
		payload_id = tostring(payload_id or instance.__active_payload_id or "current")
		return render_mount(instance, slot, payload_id)
	end

	function instance.switch_payload(payload_id)
		payload_id = tostring(payload_id or instance.__active_payload_id or "current")
		return render_mount(instance, "primary", payload_id)
	end

	function instance.list_payload_files(payload_id)
		return list_payload_files(instance, payload_id)
	end

	function instance.read_payload_file(payload_id, relative_path)
		return read_payload_file(instance, payload_id, relative_path)
	end

	function instance.write_payload_file(payload_id, relative_path, contents)
		return write_payload_file(instance, payload_id, relative_path, contents)
	end

	function instance.describe_payload(payload_id)
		return describe_payload(instance, payload_id)
	end

	function instance.compile_payload(payload_id)
		return compile_payload(instance, payload_id)
	end

	return instance
end

return M
