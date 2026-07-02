local M = {}

local function humanize_payload_id(payload_id)
	local text = tostring(payload_id or "current"):gsub("_", " "):gsub("%-", " ")
	return text:gsub("^%l", string.upper)
end

local function basename(path)
	local value = tostring(path or "")
	return value:match("([^/]+)$") or value
end

local function encode_query_component(value)
	return (tostring(value or ""):gsub("\n", "\r\n"):gsub("([^%w%-%._~])", function(char)
		return string.format("%%%02X", char:byte())
	end))
end

local function choose_selected_file(files, requested_file)
	if type(requested_file) == "string" and requested_file ~= "" then
		for _, file in ipairs(files) do
			if file == requested_file then
				return requested_file
			end
		end
	end

	local preferred = {
		"pages/home.fuwa",
		"view.fuwa",
		"app.fuwa",
		"views/home.fuwa",
		"views/layout.fuwa",
	}

	for _, candidate in ipairs(preferred) do
		for _, file in ipairs(files) do
			if file == candidate then
				return candidate
			end
		end
	end

	for _, file in ipairs(files) do
		if tostring(file):sub(-5) == ".fuwa" then
			return file
		end
	end

	return files[1]
end

local function build_payload_card(host, payload_id, selected_file)
	local descriptor = host.describe_payload(payload_id)
	if descriptor == nil then
		return nil
	end

	local files = descriptor.files or host.list_payload_files(payload_id) or {}
	local file_name = choose_selected_file(files, selected_file)
	local file_source = file_name and host.read_payload_file(payload_id, file_name) or ""
	local file_items = {}
	for _, path in ipairs(files) do
		file_items[#file_items + 1] = {
			path = path,
			name = basename(path),
			selected = path == file_name,
			inspect_url = "/inspect/" .. encode_query_component(payload_id) .. "?file=" .. encode_query_component(path),
		}
	end

	return {
		id = descriptor.id or payload_id,
		label = descriptor.label or humanize_payload_id(payload_id),
		route = descriptor.route or ("/payload/" .. payload_id .. "/"),
		exists = descriptor.exists ~= false,
		file_count = descriptor.file_count or #files,
		files = file_items,
		selected_file = file_name or "",
		selected_file_name = file_name and basename(file_name) or "",
		selected_file_source = file_source or "",
		selected_file_length = #(file_source or ""),
		save_route = "/save/" .. encode_query_component(payload_id),
		sandbox = "allow-scripts allow-forms allow-same-origin",
		bootstrap = "route",
	}
end

local function build_terminal_state(run_result)
	if type(run_result) == "table" and type(run_result.output) == "string" and run_result.output ~= "" then
		return {
			output = run_result.output,
			status = run_result.status or (run_result.success == false and "error" or "ok"),
			label = run_result.success == false and "Build failed" or "Build ok",
		}
	end

	return {
		output = "No run yet.\nSave a file to compile and refresh the preview.",
		status = "idle",
		label = "Idle",
	}
end

function M.build(host, payload_id, requested_file, run_result)
	payload_id = tostring(payload_id or "current")

	local payloads = {}
	for _, id in ipairs({ "current", "lesson" }) do
		local descriptor = host.describe_payload(id)
		if descriptor ~= nil then
			payloads[#payloads + 1] = {
				id = descriptor.id or id,
				label = descriptor.label or humanize_payload_id(id),
				route = descriptor.route or ("/payload/" .. id .. "/"),
				file_count = descriptor.file_count or 0,
				active = id == payload_id,
				switch_route = "/switch/" .. encode_query_component(id),
				summary = id == payload_id and "Active payload" or "Switch target",
			}
		end
	end

	local active = build_payload_card(host, payload_id, requested_file)
	if active == nil then
		active = {
			id = payload_id,
			label = humanize_payload_id(payload_id),
			route = "/payload/" .. payload_id .. "/",
			exists = false,
			file_count = 0,
			files = {},
			selected_file = "",
			selected_file_name = "",
			selected_file_source = "",
			selected_file_length = 0,
			save_route = "/save/" .. encode_query_component(payload_id),
			sandbox = "allow-scripts allow-forms allow-same-origin",
			bootstrap = "route",
		}
	end

	local terminal = build_terminal_state(run_result)
	active.terminal_output = terminal.output
	active.terminal_status = terminal.status
	active.terminal_label = terminal.label

	return {
		eyebrow = "Privileged shell",
		title = "Fuwa Shell",
		summary = "The host shell mounts a payload through a route-backed iframe, exposes a single-file editor, and reports compile output in the terminal panel.",
		chips = {
			"Same compiler, same render stack",
			"Route-backed iframe mount",
			"Tenant stays sandboxed",
			"Save + run loop",
		},
		preview_heading = "Mounted tenant",
		preview_note = "Route-backed tenant document",
		payloads = payloads,
		active = active,
		preview_html = host.mount_payload("preview", payload_id),
	}
end

return M
