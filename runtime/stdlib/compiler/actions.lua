local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines = require("runtime.stdlib.compiler.lines")
local responses = require("runtime.stdlib.compiler.responses")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")

local M = {}

local function emit(out, line)
	out[#out + 1] = line
end

local function emit_blank(out)
	out[#out + 1] = ""
end

local function action_bootstrap(ctx)
	if ctx.action_bootstrap_emitted then
		return
	end

	imports.emit_imports(ctx)
	ctx.out[#ctx.out + 1] = "local web = require(\"runtime.stdlib.web\")"
	ctx.out[#ctx.out + 1] = "local render = web.render"
	ctx.out[#ctx.out + 1] = "local redirect = web.redirect"
	ctx.out[#ctx.out + 1] = "local fail = web.fail"
	emit_blank(ctx.out)
	ctx.out[#ctx.out + 1] = "local M = {}"
	emit_blank(ctx.out)
	ctx.action_bootstrap_emitted = true
end

local function parse_match_block(ctx, index, match_expr)
	local source_lines = ctx.lines
	local when_clauses = {}
	local else_expr = nil

	for i = index, #source_lines do
		local line = strings.trim(source_lines[i])
		if lines.is_blank_or_comment(line) then
			goto continue
		end

		if line == "end" then
			return i + 1, {
				expr = match_expr,
				when_clauses = when_clauses,
				else_expr = else_expr
			}
		end

		local when_value, when_expr = line:match("^when%s+(.+)%s*->%s*(.+)$")
		if when_value then
			when_clauses[#when_clauses + 1] = {
				value = strings.trim(when_value),
				expr = strings.trim(when_expr)
			}
			goto continue
		end

		local parsed_else = line:match("^else%s*->%s*(.+)$")
		if parsed_else then
			else_expr = strings.trim(parsed_else)
			goto continue
		end

		diagnostics.add(ctx.diagnostics, ctx.filename, i, "Expected: when VALUE -> EXPR or else -> EXPR", source_lines[i])

		::continue::
	end

	diagnostics.add(
		ctx.diagnostics,
		ctx.filename,
		#source_lines > 0 and #source_lines or 1,
		"Unexpected EOF while parsing match block",
		source_lines[#source_lines]
	)
	return #source_lines + 1, nil
end

local function emit_match_block(out, match_entry)
	for index, when_clause in ipairs(match_entry.when_clauses) do
		emit(out, string.format("  %s %s == %s then", index == 1 and "if" or "elseif", match_entry.expr, when_clause.value))
		emit(out, "    return " .. responses.apply_response_expr(when_clause.expr))
	end

	if match_entry.else_expr then
		if #match_entry.when_clauses > 0 then
			emit(out, "  else")
			emit(out, "    return " .. responses.apply_response_expr(match_entry.else_expr))
		else
			emit(out, "  return " .. responses.apply_response_expr(match_entry.else_expr))
		end
	end

	if #match_entry.when_clauses > 0 then
		emit(out, "  end")
	end
end

local function apply_sugar(line, action_name)
	local trimmed = strings.trim(line)

	local guard_expr, guard_result = trimmed:match("^if%s+(.+)%s*%-%>%s*(.+)$")
	if guard_expr then
		return string.format("if %s then\n  return %s\nend", guard_expr, responses.apply_response_expr(guard_result))
	end

	local slot_name, slot_expr = trimmed:match("^([A-Za-z_][A-Za-z0-9_]*)%s*=%s*(.+)%s*%?$")
	if slot_name and not strings.is_reserved_word(slot_name) then
		local slot = "__r_" .. slot_name
		local expr = strings.trim(slot_expr)
		local lines_out = {
			string.format("local %s = %s", slot, expr),
			string.format("local %s", slot_name),
			string.format("if %s == nil then", slot),
			"  return fail({ kind = \"not_found\", message = \"not found\" }, {",
			string.format("    action = %s,", strings.quote_lua_string(action_name)),
			"    line = 0,",
			string.format("    expr = %s", strings.quote_lua_string(expr)),
			"  })",
			"end",
			string.format("if (type(%s) == \"table\" or type(%s) == \"userdata\") and %s.ok ~= nil then", slot, slot, slot),
			string.format("  if not %s.ok then", slot),
			"    return fail(__ERROR__, {",
			string.format("      action = %s,", strings.quote_lua_string(action_name)),
			"      line = 0,",
			string.format("      expr = %s", strings.quote_lua_string(expr)),
			"    })",
			"  end",
			string.format("  %s = %s.value", slot_name, slot),
			"else",
			string.format("  %s = %s", slot_name, slot),
			"end"
		}

		return (table.concat(lines_out, "\n"):gsub("__ERROR__", slot .. ".err"))
	end

	if strings.starts_with(trimmed, "render ") then
		local rendered = responses.parse_render(trimmed)
		if rendered then
			return "return " .. rendered
		end
	end

	if strings.starts_with(trimmed, "redirect ") then
		local redirected = responses.parse_redirect(trimmed)
		if redirected then
			return "return " .. redirected
		end
	end

	local plain_assignment_name, plain_assignment_value = trimmed:match("^([A-Za-z_][A-Za-z0-9_]*)%s*=%s*(.+)$")
	if plain_assignment_name and not strings.is_reserved_word(plain_assignment_name) then
		return string.format("local %s = %s", plain_assignment_name, plain_assignment_value)
	end

	return trimmed
end

local function emit_action_body_entry(ctx, body_entry)
	if body_entry.match_entry then
		emit_match_block(ctx.out, body_entry.match_entry)
		return
	end

	local transformed = apply_sugar(body_entry.line, body_entry.action_name)
	for part in transformed:gmatch("([^\n]+)") do
		emit(ctx.out, "  " .. part)
	end
end

function M.compile_action_block(ctx, index, action_name, action_arg)
	ctx.has_actions = true
	action_bootstrap(ctx)

	local source_lines = ctx.lines
	local body = {}

	local i = index
	while i <= #source_lines do
		local line = strings.trim(source_lines[i])
		if lines.is_blank_or_comment(line) then
			i = i + 1
		elseif line == "end" then
			emit(ctx.out, string.format("function M.%s(%s)", action_name, action_arg))
			for _, entry in ipairs(body) do
				emit_action_body_entry(ctx, entry)
			end
			emit(ctx.out, "end")
			emit_blank(ctx.out)
			return i + 1
		else
			local match_expr = line:match("^match%s+(.+)%s+do$")
			if match_expr then
				local next_index, match_entry = parse_match_block(ctx, i + 1, strings.trim(match_expr))
				if match_entry then
					body[#body + 1] = {
						match_entry = match_entry,
						action_name = action_name
					}
				end
				i = next_index
			else
				body[#body + 1] = {
					line = line,
					action_name = action_name
				}
				i = i + 1
			end
		end
	end

	diagnostics.add(
		ctx.diagnostics,
		ctx.filename,
		#source_lines > 0 and #source_lines or 1,
		"Unexpected EOF while parsing action block",
		source_lines[#source_lines]
	)
	return #source_lines + 1
end

return M
