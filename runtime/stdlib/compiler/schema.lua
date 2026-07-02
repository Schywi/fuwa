local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines = require("runtime.stdlib.compiler.lines")
local imports = require("runtime.stdlib.compiler.imports")
local strings = require("runtime.stdlib.compiler.strings")

local M = {}

local function parse_field_flags(rest)
	local flags = {}

	if rest:find("required", 1, true) then
		flags.required = true
	end

	if rest:find("unique", 1, true) then
		flags.unique = true
	end

	if rest:find("redact", 1, true) then
		flags.redact = true
	end

	local default_value = rest:match("default%s+(.+)$")
	if default_value then
		flags.default = strings.parse_default_value(default_value)
	end

	return flags
end

local function parse_list_values(raw)
	local values = {}
	for part in raw:gmatch("([^,]+)") do
		local trimmed = strings.trim(part)
		if trimmed ~= "" then
			values[#values + 1] = trimmed
		end
	end
	return values
end

local function parse_change_block(ctx, index, change_name)
	local source_lines = ctx.lines
	local accept = {}
	local required_fields = {}

	local i = index
	while i <= #source_lines do
		local line = strings.trim(source_lines[i])
		if lines.is_blank_or_comment(line) then
			i = i + 1
		elseif line == "end" then
			return i + 1, {
				name = change_name,
				accept = accept,
				require = required_fields
			}
		else
			local accept_values = line:match("^accept%s+(.+)$")
			if accept_values then
				for _, value in ipairs(parse_list_values(accept_values)) do
					accept[#accept + 1] = value
				end
				i = i + 1
			else
					local require_values = line:match("^require%s+(.+)$")
					if require_values then
						for _, value in ipairs(parse_list_values(require_values)) do
							required_fields[#required_fields + 1] = value
						end
						i = i + 1
				else
					diagnostics.add(ctx.diagnostics, ctx.filename, i, "Expected: accept FIELDS or require FIELDS", source_lines[i])
					i = i + 1
				end
			end
		end
	end

	diagnostics.add(
		ctx.diagnostics,
		ctx.filename,
		#source_lines > 0 and #source_lines or 1,
		"Unexpected EOF while parsing change block",
		source_lines[#source_lines]
	)
	return #source_lines + 1, nil
end

local function emit_schema(ctx, schema)
	imports.emit_imports(ctx)
	ctx.out[#ctx.out + 1] = "local schema = require(\"runtime.stdlib.schema\")"
	ctx.out[#ctx.out + 1] = ""
	ctx.out[#ctx.out + 1] = string.format(
		"return schema.model(%s, %s, {",
		strings.quote_lua_string(schema.name),
		strings.quote_lua_string(schema.table_name)
	)

	for _, field in ipairs(schema.fields) do
		local flag_parts = {}
		if field.flags.required then
			flag_parts[#flag_parts + 1] = "required = true"
		end
		if field.flags.unique then
			flag_parts[#flag_parts + 1] = "unique = true"
		end
		if field.flags.redact then
			flag_parts[#flag_parts + 1] = "redact = true"
		end
		if field.flags.default ~= nil then
			flag_parts[#flag_parts + 1] = "default = " .. strings.format_default_value(field.flags.default)
		end

		ctx.out[#ctx.out + 1] = string.format(
			"  schema.field(%s, %s, %s),",
			strings.quote_lua_string(field.name),
			strings.quote_lua_string(field.type),
			#flag_parts > 0 and "{ " .. table.concat(flag_parts, ", ") .. " }" or "{}"
		)
	end

	for _, change in ipairs(schema.changes) do
		ctx.out[#ctx.out + 1] = string.format("  schema.change(%s, {", strings.quote_lua_string(change.name))
		ctx.out[#ctx.out + 1] = "    accept = { " .. table.concat((function()
			local items = {}
			for _, value in ipairs(change.accept) do
				items[#items + 1] = strings.quote_lua_string(value)
			end
			return items
		end)(), ", ") .. " },"
		ctx.out[#ctx.out + 1] = "    require = { " .. table.concat((function()
			local items = {}
			for _, value in ipairs(change.require) do
				items[#items + 1] = strings.quote_lua_string(value)
			end
			return items
		end)(), ", ") .. " },"
		ctx.out[#ctx.out + 1] = "  }),"
	end

	if schema.has_timestamps then
		ctx.out[#ctx.out + 1] = "  schema.timestamps(),"
	end

	ctx.out[#ctx.out + 1] = "})"
end

function M.compile_schema_block(ctx, index, table_name)
	local source_lines = ctx.lines
	local schema = {
		name = ctx.module_name or table_name,
		table_name = table_name,
		fields = {},
		changes = {},
		has_timestamps = false
	}

	local i = index
	while i <= #source_lines do
		local line = strings.trim(source_lines[i])
		if lines.is_blank_or_comment(line) then
			i = i + 1
		elseif line == "end" then
			emit_schema(ctx, schema)
			return i + 1
		elseif line == "timestamps" then
			schema.has_timestamps = true
			i = i + 1
		else
			local change_name = line:match("^change%s+([A-Za-z_][A-Za-z0-9_]*)%s+do$")
			if change_name then
				local next_index, change = parse_change_block(ctx, i + 1, change_name)
				if change then
					schema.changes[#schema.changes + 1] = change
				end
				i = next_index
			else
				local field_name, field_type, rest = line:match("^field%s+([A-Za-z_][A-Za-z0-9_]*)%s*:%s*([A-Za-z_][A-Za-z0-9_]*)(.*)$")
				if field_name then
					schema.fields[#schema.fields + 1] = {
						name = field_name,
						type = field_type,
						flags = parse_field_flags(strings.trim(rest))
					}
					i = i + 1
				else
					diagnostics.add(
						ctx.diagnostics,
						ctx.filename,
						i,
						"Expected: field name: type [required] [unique] [redact] [default VALUE]",
						source_lines[i]
					)
					i = i + 1
				end
			end
		end
	end

	diagnostics.add(
		ctx.diagnostics,
		ctx.filename,
		#source_lines > 0 and #source_lines or 1,
		"Unexpected EOF while parsing schema block",
		source_lines[#source_lines]
	)
	return #source_lines + 1
end

return M
