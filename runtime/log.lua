local M = {}

function M.serialize(value, depth)
	depth = depth or 0

	local value_type = type(value)
	if value_type == "nil" or value_type == "number" or value_type == "boolean" then
		return tostring(value)
	end
	if value_type == "string" then
		return string.format("%q", value)
	end
	if value_type ~= "table" then
		return tostring(value)
	end

	if depth >= 2 then
		return "{...}"
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
		parts[#parts + 1] = tostring(key) .. "=" .. M.serialize(value[key], depth + 1)
	end

	return "{" .. table.concat(parts, ", ") .. "}"
end

function M.format_fields(fields)
	if type(fields) ~= "table" then
		return ""
	end

	local keys = {}
	for key in pairs(fields) do
		keys[#keys + 1] = key
	end

	table.sort(keys, function(left, right)
		return tostring(left) < tostring(right)
	end)

	local parts = {}
	for _, key in ipairs(keys) do
		parts[#parts + 1] = tostring(key) .. "=" .. M.serialize(fields[key])
	end

	return table.concat(parts, " ")
end

function M.pretty_sink(event)
	if type(event) ~= "table" then
		return
	end

	local depth = tonumber(event.depth or 0) or 0
	local indent = string.rep("  ", depth)

	if event.kind == "span_start" then
		local parts = {
			indent .. "▶ " .. tostring(event.name or "span"),
		}

		local attrs = M.format_fields(event.attrs)
		if attrs ~= "" then
			parts[#parts + 1] = attrs
		end
		parts[#parts + 1] = "trace=" .. tostring(event.trace_id or "-")

		io.stderr:write(table.concat(parts, " "), "\n")
		io.stderr:flush()
		return
	end

	if event.kind == "span_log" then
		local parts = {
			indent .. "· " .. tostring(event.message or "event"),
		}

		local fields = M.format_fields(event.fields)
		if fields ~= "" then
			parts[#parts + 1] = fields
		end
		parts[#parts + 1] = "trace=" .. tostring(event.trace_id or "-")

		io.stderr:write(table.concat(parts, " "), "\n")
		io.stderr:flush()
		return
	end

	if event.kind == "span_end" then
		if event.name == "request" then
			return
		end

		local parts = {
			indent .. "◀ " .. tostring(event.name or "span"),
		}

		local attrs = M.format_fields(event.attrs)
		if attrs ~= "" then
			parts[#parts + 1] = attrs
		end
		parts[#parts + 1] = string.format("%.1fms", tonumber(event.duration_ms or 0) or 0)
		parts[#parts + 1] = "trace=" .. tostring(event.trace_id or "-")

		if event.failed then
			parts[#parts + 1] = "error=" .. M.serialize(event.error)
		end

		io.stderr:write(table.concat(parts, " "), "\n")
		io.stderr:flush()
	end
end

return M
