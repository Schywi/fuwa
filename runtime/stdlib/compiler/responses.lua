local strings = require("runtime.stdlib.compiler.strings")

local M = {}

function M.parse_render(line)
	local view_name, rest = line:match("^render%s+\"([^\"]+)\"(.*)$")
	if not view_name then
		return nil
	end

	rest = strings.trim(rest or ""):gsub("^,%s*", "")
	if rest == "" then
		return string.format("render(%s, {})", strings.quote_lua_string(view_name))
	end

	local args = strings.parse_key_value_args(rest)
	if not args then
		return nil
	end

	return string.format("render(%s, %s)", strings.quote_lua_string(view_name), args)
end

function M.parse_redirect(line)
	local target = line:match("^redirect%s+(.+)$")
	if not target then
		return nil
	end

	return string.format("redirect(%s)", strings.interpolate_lua_expression(target))
end

function M.parse_fail(line)
	local body = strings.trim(line)
	local tail = strings.trim((body:match("^fail%s+(.+)$") or body) or "")
	if tail == "" then
		return nil
	end

	local atom_name, atom_rest = tail:match("^:([A-Za-z_][A-Za-z0-9_]*)(.*)$")
	if atom_name then
		local args = strings.parse_key_value_args(strings.trim(atom_rest or ""):gsub("^,%s*", ""))
		if not args then
			return nil
		end

		return string.format("fail(%s, %s)", strings.quote_lua_string(atom_name), args)
	end

	local expr, rest = tail:match("^([^,]+)(.*)$")
	if not expr then
		return nil
	end

	expr = strings.trim(expr)
	rest = strings.trim(rest or ""):gsub("^,%s*", "")
	if rest == "" then
		return string.format("fail(%s)", expr)
	end

	local args = strings.parse_key_value_args(rest)
	if not args then
		return nil
	end

	return string.format("fail(%s, %s)", expr, args)
end

function M.apply_response_expr(expr)
	if strings.starts_with(expr, "render ") then
		return M.parse_render(expr) or expr
	end

	if strings.starts_with(expr, "redirect ") then
		return M.parse_redirect(expr) or expr
	end

	if strings.starts_with(expr, "fail ") then
		return M.parse_fail(expr) or expr
	end

	return expr
end

return M
