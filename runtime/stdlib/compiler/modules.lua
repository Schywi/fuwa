local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines = require("runtime.stdlib.compiler.lines")
local imports = require("runtime.stdlib.compiler.imports")
local schema = require("runtime.stdlib.compiler.schema")
local routes = require("runtime.stdlib.compiler.routes")
local actions = require("runtime.stdlib.compiler.actions")
local view = require("runtime.stdlib.compiler.view")
local strings = require("runtime.stdlib.compiler.strings")

local M = {}

local function new_context(filename, source)
	return {
		filename = filename,
		lines = lines.split(source),
		out = {},
		diagnostics = {},
		imports = {},
		imports_emitted = false,
		action_bootstrap_emitted = false,
		has_actions = false,
		module_name = nil,
		mode = nil
	}
end

local function emit_error(ctx, line_number, message)
	diagnostics.add(ctx.diagnostics, ctx.filename, line_number, message, ctx.lines[line_number])
end

local function compile_module_source(source, filename)
	local ctx = new_context(filename, source)
	local i = 1
	while i <= #ctx.lines do
		local line = ctx.lines[i]
		local trimmed = strings.trim(line)

		if lines.is_blank_or_comment(line) then
			i = i + 1
		else
			local module_name = trimmed:match("^module%s+([A-Za-z_][A-Za-z0-9_]*)$")
			if module_name then
				ctx.module_name = module_name
				i = i + 1
			else
				local use_name = trimmed:match("^use%s+([A-Za-z_][A-Za-z0-9_]*)$")
				if use_name then
					i = i + 1
				elseif trimmed == "import" then
					i = imports.parse_import_block(ctx, i + 1)
				else
					local schema_name = trimmed:match('^schema%s+"([^"]+)"%s+do$')
					if schema_name then
						if ctx.mode and ctx.mode ~= "schema" then
							emit_error(ctx, i, "Mixed block types are not supported in one file")
							i = i + 1
						else
							ctx.mode = "schema"
							i = schema.compile_schema_block(ctx, i + 1, schema_name)
						end
					else
						if trimmed == "routes do" then
							if ctx.mode and ctx.mode ~= "routes" then
								emit_error(ctx, i, "Mixed block types are not supported in one file")
								i = i + 1
							else
								ctx.mode = "routes"
								i = routes.compile_routes_block(ctx, i + 1)
							end
						else
							local action_name, action_arg = trimmed:match("^action%s+([A-Za-z_][A-Za-z0-9_]*)%(([A-Za-z_][A-Za-z0-9_]*)%)%s+do$")
							if action_name then
								if ctx.mode and ctx.mode ~= "action" then
									emit_error(ctx, i, "Mixed block types are not supported in one file")
									i = i + 1
								else
									ctx.mode = "action"
									i = actions.compile_action_block(ctx, i + 1, action_name, action_arg)
								end
							else
								emit_error(ctx, i, "Unexpected line at top level")
								i = i + 1
							end
						end
					end
				end
			end
		end
	end

	if ctx.has_actions then
		ctx.out[#ctx.out + 1] = "return M"
	end

	if diagnostics.has_errors(ctx.diagnostics) then
		return {
			lua = nil,
			diagnostics = ctx.diagnostics
		}
	end

	return {
		lua = table.concat(ctx.out, "\n"),
		diagnostics = ctx.diagnostics
	}
end

function M.compile_module_source(source, filename)
	return compile_module_source(source, filename)
end

function M.compile_view_source(source, source_files, filename)
	return view.compile_view_module(source, source_files, filename)
end

return M
