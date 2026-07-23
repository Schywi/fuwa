local log = require("runtime.log")

local M = {
	json_null = {},
}

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", [['"'"']]) .. "'"
end

local function trim_trailing_zeroes(value)
	local text = string.format("%.3f", tonumber(value) or 0)
	text = text:gsub("(%..-)0+$", "%1")
	text = text:gsub("%.$", "")
	return text
end

local function json_escape(value)
	local text = tostring(value or "")
	text = text:gsub("\\", "\\\\")
	text = text:gsub('"', '\\"')
	text = text:gsub("\b", "\\b")
	text = text:gsub("\f", "\\f")
	text = text:gsub("\n", "\\n")
	text = text:gsub("\r", "\\r")
	text = text:gsub("\t", "\\t")
	return text
end

local function encode_json(value)
	local value_type = type(value)

	if value == M.json_null then
		return "null"
	end
	if value_type == "nil" then
		return "null"
	end
	if value_type == "boolean" then
		return value and "true" or "false"
	end
	if value_type == "number" then
		return trim_trailing_zeroes(value)
	end
	if value_type == "string" then
		return '"' .. json_escape(value) .. '"'
	end
	if value_type ~= "table" then
		return '"' .. json_escape(tostring(value)) .. '"'
	end

	local keys = {}
	for key in pairs(value) do
		keys[#keys + 1] = key
	end

	table.sort(keys, function(left, right)
		return tostring(left) < tostring(right)
	end)

	local parts = {}
	for _, key in ipairs(keys) do
		parts[#parts + 1] = '"' .. json_escape(key) .. '":' .. encode_json(value[key])
	end

	return "{" .. table.concat(parts, ",") .. "}"
end

function M.vector_url(getenv)
	getenv = getenv or os.getenv
	local url = getenv("FUWA_VECTOR_URL")
	if url == nil or url == "" then
		return nil
	end
	return url
end

function M.build_payload(event, opts)
	opts = opts or {}
	if type(event) ~= "table" or event.kind ~= "request" then
		return nil
	end

	local now = opts.now
	local status = tonumber(event.status)
	if status == nil and event.failed then
		status = 500
	end
	status = status or 0

	local failed = event.failed == true or status >= 500
	local error_text = M.json_null
	if event.failed and event.error ~= nil then
		error_text = log.serialize(event.error)
	end

	return {
		timestamp = type(now) == "function" and now() or os.date("!%Y-%m-%dT%H:%M:%SZ"),
		service = opts.service or "fuwa",
		kind = "request",
		trace_id = tostring(event.trace_id or ""),
		method = tostring(event.method or ""),
		route = tostring(event.path or ""),
		status = status,
		duration_ms = tonumber(event.duration_ms) or 0,
		request_total = 1,
		error_total = failed and 1 or 0,
		error = error_text,
	}
end

function M.encode_payload(payload)
	return encode_json(payload)
end

function M.build_command(url, body)
	return table.concat({
		"curl",
		"--silent",
		"--show-error",
		"--max-time",
		"0.5",
		"--retry",
		"0",
		"--request",
		"POST",
		"--header",
		shell_quote("Content-Type: application/json"),
		"--data-binary",
		shell_quote(body),
		shell_quote(url),
		">/dev/null 2>&1 &",
	}, " ")
end

function M.forward_event(event, opts)
	opts = opts or {}
	local url = opts.url or M.vector_url(opts.getenv)
	if url == nil then
		return false, "disabled"
	end

	local payload = M.build_payload(event, opts)
	if payload == nil then
		return false, "ignored"
	end

	local run = opts.run or os.execute
	local command = M.build_command(url, M.encode_payload(payload))
	local ok, reason, code = run(command)
	if ok == false or ok == nil then
		return false, reason or code or "spawn_failed"
	end

	return true
end

function M.wrap_sink(base_sink, opts)
	return function(event)
		if type(base_sink) == "function" then
			base_sink(event)
		end

		local ok, err = M.forward_event(event, opts)
		if not ok and err ~= "disabled" and err ~= "ignored" then
			io.stderr:write("vector telemetry drop: " .. tostring(err) .. "\n")
			io.stderr:flush()
		end
	end
end

return M
