local trace = require("runtime.trace")

local M = {}

local function dirname(path)
	return (path and path:match("^(.*)/[^/]*$")) or "."
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

local function file_exists(path)
	local file = io.open(path, "rb")
	if file then
		file:close()
		return true
	end
	return false
end

local function validate_payload_id(payload_id)
	if type(payload_id) ~= "string" then
		return nil
	end

	if payload_id:match("^[A-Za-z0-9_%-]+$") then
		return payload_id
	end

	return nil
end

local function build_preview_frame(slot, payload_id)
	return table.concat({
		'<iframe class="shell-preview-frame"',
		' data-host-slot="' .. escape_html(slot) .. '"',
		' sandbox="allow-scripts allow-forms"',
		' title="Payload preview"',
		' src="/payload/' .. escape_html(payload_id) .. '/"',
		'></iframe>',
	}, "")
end

local function error_frame(slot, payload_id, message)
	return table.concat({
		'<div class="shell-preview-error"',
		' data-host-slot="' .. escape_html(slot) .. '"',
		' data-payload-id="' .. escape_html(payload_id) .. '"',
		'>',
		escape_html(message),
		"</div>",
	}, "")
end

local function payload_path(payload_root, payload_id)
	return payload_root .. "/" .. payload_id
end

local function render_mount(instance, slot, payload_id)
	return trace.span("host.mount_payload", {
		slot = slot,
		payload_id = payload_id,
	}, function(span)
		local normalized_id = validate_payload_id(payload_id or instance.__active_payload_id or "current")
		if normalized_id == nil then
			span:set("status", 400)
			span:set("result", "invalid_payload_id")
			return error_frame(slot, tostring(payload_id or ""), "Invalid payload id")
		end

		local app_path = payload_path(instance.__payload_root, normalized_id) .. "/app.fuwa"
		if not file_exists(app_path) then
			span:set("status", 404)
			span:set("result", "missing_payload")
			span:set("app_path", app_path)
			return error_frame(slot, normalized_id, "Payload not found")
		end

		instance.__active_slot = slot
		instance.__active_payload_id = normalized_id
		span:set("status", 200)
		span:set("result", "ok")
		span:set("route", "/payload/" .. normalized_id .. "/")
		return build_preview_frame(slot, normalized_id)
	end)
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

	return instance
end

return M
