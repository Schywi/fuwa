local M = {}

local function humanize_payload_id(payload_id)
	local text = tostring(payload_id or "current"):gsub("_", " "):gsub("%-", " ")
	return (text:gsub("(%a)([%w']*)", function(first, rest)
		return first:upper() .. rest:lower()
	end))
end

local function basename(path)
	local value = tostring(path or "")
	return value:match("([^/]+)$") or value
end

local function dirname(path)
	local value = tostring(path or "")
	return value:match("^(.*)/[^/]+$") or ""
end

local function file_kind_label(path)
	local directory = dirname(path)
	if directory == "" then
		return "ROOT"
	end
	if directory == "pages" then
		return "PAGE"
	end
	if directory == "models" then
		return "DATA"
	end
	if directory:match("^views/fragments") then
		return "FRAG"
	end
	if directory:match("^views") then
		return "VIEW"
	end
	if tostring(path):sub(-3) == ".js" then
		return "JS"
	end
	return "FILE"
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
		"app.fuwa",
		"pages/gomen.fuwa",
		"pages/home.fuwa",
		"view.fuwa",
		"views/gomen.fuwa",
		"views/layout.fuwa",
		"views/home.fuwa",
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
			directory = dirname(path),
			directory_label = dirname(path) ~= "" and (dirname(path) .. "/") or "root entry",
			kind_label = file_kind_label(path),
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
		switch_route = "/switch/" .. encode_query_component(payload_id),
		selected_file = file_name or "",
		selected_file_name = file_name and basename(file_name) or "",
		selected_file_source = file_source or "",
		selected_file_length = #(file_source or ""),
		sandbox = "allow-scripts allow-forms allow-same-origin",
		bootstrap = "route",
	}
end

local function hash_text(text)
	local hash = 5381
	for index = 1, #text do
		hash = (hash * 33 + text:byte(index)) % 4294967296
	end
	return string.format("%08x", hash)
end

local function build_terminal_state(run_result)
	if type(run_result) == "table" and type(run_result.output) == "string" and run_result.output ~= "" then
		local output = run_result.output
		local success = run_result.success ~= false
		return {
			output = output,
			status = run_result.status or (success and "ok" or "error"),
			label = success and "ready" or "error",
			build_label = success and "build ok" or "build failed",
			run_id = hash_text(output) .. "-" .. tostring(os.time()),
		}
	end

	return {
		output = "No pipeline output yet.",
		status = "idle",
		label = "idle",
		build_label = "idle",
		run_id = "idle",
	}
end

function M.build(host, payload_id, requested_file, run_result)
	payload_id = tostring(payload_id or "current")

	if run_result == nil and host and type(host.compile_payload) == "function" then
		local compiled = host.compile_payload(payload_id)
		if type(compiled) == "table" and compiled.ok == true then
			run_result = compiled.value
		end
	end

	local payloads = {}
	for _, id in ipairs({ "current", "fuwa-gomen" }) do
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
			sandbox = "allow-scripts allow-forms allow-same-origin",
			bootstrap = "route",
		}
	end

	local terminal = build_terminal_state(run_result)
	active.terminal_output = terminal.output
	active.terminal_status = terminal.status
	active.terminal_label = terminal.label
	active.build_label = terminal.build_label
	active.terminal_run_id = terminal.run_id
	active.bundle_url = "/runtime/" .. encode_query_component(active.id) .. "/bundle.json"

	return {
		eyebrow = "pipeline smoke test",
		title = "pipeline smoke test",
		subtitle = tostring(active.file_count) .. " documents · " .. terminal.build_label,
		summary = "The test panel exposes the payload workspace, code view, and runtime state in one compact shell.",
		breadcrumb = {
			{ label = "static", active = false },
			{ label = active.label, active = false },
			{ label = active.selected_file ~= "" and active.selected_file or "no file", active = true },
		},
		runtime_state = terminal.status == "error" and "error" or "ready",
		footer_label = "test-panel ready",
		preview_heading = "Browser runtime",
		preview_note = "In-memory live session",
		runtime_tenant_url = "/runtime/tenant.html",
		runtime_worker_url = "/shell/hooks/runtime-worker.js",
		payloads = payloads,
		active = active,
		preview_html = "",
	}
end

return M
