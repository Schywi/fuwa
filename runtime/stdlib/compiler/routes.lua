local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines = require("runtime.stdlib.compiler.lines")
local imports = require("runtime.stdlib.compiler.imports")
local strings = require("runtime.stdlib.compiler.strings")

local M = {}

function M.compile_routes_block(ctx, index)
	local source_lines = ctx.lines
	local routes = {}

	local i = index
	while i <= #source_lines do
		local line = strings.trim(source_lines[i])
		if lines.is_blank_or_comment(line) then
			i = i + 1
		elseif line == "end" then
			imports.emit_imports(ctx)
			ctx.out[#ctx.out + 1] = "local web = require(\"fuwa.runtime.web\")"
			ctx.out[#ctx.out + 1] = ""
			ctx.out[#ctx.out + 1] = "return web.app({"
			for _, route in ipairs(routes) do
				ctx.out[#ctx.out + 1] = route
			end
			ctx.out[#ctx.out + 1] = "})"
			return i + 1
		else
			local method, path, handler = line:match("^([A-Za-z]+)%s+\"([^\"]+)\"%s+(.+)$")
			if method then
				routes[#routes + 1] = string.format(
					"  web.%s(%s, %s),",
					method,
					strings.quote_lua_string(path),
					handler
				)
			else
				diagnostics.add(ctx.diagnostics, ctx.filename, i, 'Expected: METHOD "path" handler.function', source_lines[i])
			end

			i = i + 1
		end
	end

	diagnostics.add(
		ctx.diagnostics,
		ctx.filename,
		#source_lines > 0 and #source_lines or 1,
		"Unexpected EOF while parsing routes block",
		source_lines[#source_lines]
	)
	return #source_lines + 1
end

return M
