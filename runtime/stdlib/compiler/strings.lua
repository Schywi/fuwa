local M = {}

function M.trim(value)
	return (tostring(value or ""):match("^%s*(.-)%s*$")) or ""
end

function M.starts_with(value, prefix)
	return value:sub(1, #prefix) == prefix
end

function M.quote_lua_string(value)
	local text = tostring(value or "")
	text = text:gsub("\\", "\\\\")
	text = text:gsub('"', '\\"')
	text = text:gsub("\r", "\\r")
	text = text:gsub("\n", "\\n")
	text = text:gsub("\t", "\\t")
	text = text:gsub("\f", "\\f")
	text = text:gsub("\b", "\\b")
	return '"' .. text .. '"'
end

function M.module_path_to_require_path(path)
	local require_path = tostring(path or ""):gsub("/", ".")
	return require_path
end

function M.parse_default_value(raw)
	local token = M.trim(raw)

	if token:match("^-?%d+%.?%d*$") then
		return tonumber(token)
	end

	if token == "true" then
		return true
	end

	if token == "false" then
		return false
	end

	local quoted = token:match('^"(.*)"$') or token:match("^'(.*)'$")
	if quoted ~= nil then
		return quoted
	end

	return token
end

function M.format_default_value(value)
	if type(value) == "number" or type(value) == "boolean" then
		return tostring(value)
	end

	return M.quote_lua_string(value)
end

function M.parse_key_value_args(raw)
	local trimmed = M.trim(raw)
	if trimmed == "" then
		return nil
	end

	local parts = {}
	for piece in trimmed:gmatch("([^,]+)") do
		local part = M.trim(piece)
		if part ~= "" then
			local key, value = part:match("^([A-Za-z_][A-Za-z0-9_]*)%s*:%s*(.+)$")
			if not key then
				return nil
			end
			parts[#parts + 1] = string.format("%s = %s", key, M.trim(value))
		end
	end

	if #parts == 0 then
		return nil
	end

	return "{ " .. table.concat(parts, ", ") .. " }"
end

function M.interpolate_lua_expression(raw)
	local value = M.trim(raw)
	if not value:find("#{", 1, true) then
		return value
	end

	local open_quote = value:sub(1, 1)
	if (open_quote ~= '"' and open_quote ~= "'") or value:sub(-1) ~= open_quote then
		return value
	end

	local inner = value:sub(2, -2)
	local parts = {}
	local cursor = 1

	while cursor <= #inner do
		local start_pos = inner:find("#{", cursor, true)
		if not start_pos then
			local tail = inner:sub(cursor)
			if tail ~= "" then
				parts[#parts + 1] = M.quote_lua_string(tail)
			end
			break
		end

		if start_pos > cursor then
			parts[#parts + 1] = M.quote_lua_string(inner:sub(cursor, start_pos - 1))
		end

		local end_pos = inner:find("}", start_pos + 2, true)
		if not end_pos then
			parts[#parts + 1] = M.quote_lua_string(inner:sub(start_pos))
			break
		end

		local expr = M.trim(inner:sub(start_pos + 2, end_pos - 1))
		parts[#parts + 1] = string.format("tostring(%s)", expr)
		cursor = end_pos + 1
	end

	if #parts == 0 then
		return value
	end

	return table.concat(parts, " .. ")
end

function M.is_reserved_word(value)
	local reserved_words = {
		["and"] = true,
		["break"] = true,
		["do"] = true,
		["else"] = true,
		["elseif"] = true,
		["end"] = true,
		["false"] = true,
		["for"] = true,
		["function"] = true,
		["goto"] = true,
		["if"] = true,
		["in"] = true,
		["local"] = true,
		["nil"] = true,
		["not"] = true,
		["or"] = true,
		["repeat"] = true,
		["return"] = true,
		["then"] = true,
		["true"] = true,
		["until"] = true,
		["while"] = true
	}

	return reserved_words[value] == true
end

return M
