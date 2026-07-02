local M = {}

local function enabled()
	return os.getenv("FUWA_TRACE") == "1" or os.getenv("FUWA_DB_TRACE") == "1"
end

local function serialize(value, depth)
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
		parts[#parts + 1] = tostring(key) .. "=" .. serialize(value[key], depth + 1)
	end

	return "{" .. table.concat(parts, ", ") .. "}"
end

function M.log(scope, event, fields)
	if not enabled() then
		return
	end

	local parts = { "[" .. tostring(scope) .. "]", tostring(event) }
	if type(fields) == "table" then
		local keys = {}
		for key in pairs(fields) do
			keys[#keys + 1] = key
		end

		table.sort(keys, function(left, right)
			return tostring(left) < tostring(right)
		end)

		for _, key in ipairs(keys) do
			parts[#parts + 1] = tostring(key) .. "=" .. serialize(fields[key])
		end
	end

	io.stderr:write(table.concat(parts, " "), "\n")
	io.stderr:flush()
end

return M
