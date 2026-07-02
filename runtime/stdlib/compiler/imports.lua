local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines = require("runtime.stdlib.compiler.lines")
local strings = require("runtime.stdlib.compiler.strings")

local M = {}

function M.parse_import_block(ctx, index)
	local source_lines = ctx.lines

	for i = index, #source_lines do
		local line = strings.trim(source_lines[i])
		if lines.is_blank_or_comment(line) then
			goto continue
		end

		if line == "end" then
			return i + 1
		end

		local alias, path = line:match("^([A-Za-z_][A-Za-z0-9_]*)%s+\"([^\"]+)\"$")
		if alias then
			ctx.imports[#ctx.imports + 1] = {
				alias = alias,
				path = path
			}
		else
			diagnostics.add(ctx.diagnostics, ctx.filename, i, 'Expected: Alias "path/to/module"', source_lines[i])
		end

		::continue::
	end

	diagnostics.add(
		ctx.diagnostics,
		ctx.filename,
		#source_lines > 0 and #source_lines or 1,
		"Unexpected EOF while parsing import block",
		source_lines[#source_lines]
	)
	return #source_lines + 1
end

function M.emit_imports(ctx)
	if ctx.imports_emitted then
		return
	end

	for _, item in ipairs(ctx.imports) do
		ctx.out[#ctx.out + 1] = string.format(
			"local %s = require(%s)",
			item.alias,
			strings.quote_lua_string(strings.module_path_to_require_path(item.path))
		)
	end

	if #ctx.imports > 0 then
		ctx.out[#ctx.out + 1] = ""
	end

	ctx.imports_emitted = true
end

return M
