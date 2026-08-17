local view = require("runtime.stdlib.view")
local web = require("runtime.stdlib.web")

local M = {}

local function dirname(path)
	return (path and path:match("^(.*)/[^/]*$")) or "."
end

local function read_all(path)
	local file = io.open(path, "rb")
	if not file then
		return nil
	end

	local contents = file:read("*a")
	file:close()
	return contents
end

local function validate_fragment_name(fragment_name)
	if type(fragment_name) ~= "string" or fragment_name == "" then
		return nil
	end

	if fragment_name:sub(1, 1) == "/" then
		return nil
	end

	if fragment_name:find("/", 1, true) or fragment_name:find("%.%.", 1, true) then
		return nil
	end

	if not fragment_name:match("^[%w_%-]+$") then
		return nil
	end

	return fragment_name
end

local script_source = debug.getinfo(1, "S").source
local script_path = script_source:sub(1, 1) == "@" and script_source:sub(2) or script_source
local root_dir = dirname(dirname(dirname(script_path)))
local shell_views_root = root_dir .. "/shell"

-- The compiler expands <include> at compile time; fragments rendered at
-- runtime need the same expansion. Matches exactly the compiler's shape:
-- <include src="..." />, paths relative to the shell root, no directives.
local function expand_includes(source, depth)
	depth = depth or 0
	if depth > 8 then
		return source
	end

	return (source:gsub('<include%s+src="([^"]+)"%s*/>', function(include_path)
		if include_path:sub(1, 1) == "/" or include_path:find("%.%.", 1, true) then
			return ""
		end

		local included = read_all(shell_views_root .. "/" .. include_path)
		if included == nil then
			return ""
		end

		return expand_includes(included, depth + 1)
	end))
end

local function read_source(path)
	local source = read_all(path)
	if source == nil then
		return nil
	end
	return expand_includes(source)
end

function M.render_fragment(fragment_name, data)
	local normalized_name = validate_fragment_name(fragment_name)
	if normalized_name == nil then
		return web.dev_error_html({
			_type = "error",
			err = {
				kind = "invalid_path",
				message = "Invalid shell fragment path",
			},
			action = "render_fragment",
			line = 0,
			expr = tostring(fragment_name or ""),
		})
	end

	local source = read_source(shell_views_root .. "/views/fragments/" .. normalized_name .. ".fuwa")
	if source == nil then
		return web.dev_error_html({
			_type = "error",
			err = {
				kind = "missing_fragment",
				message = "Missing shell fragment template",
			},
			action = "render_fragment",
			line = 0,
			expr = normalized_name,
		})
	end

	local html, err = view.render(source, data or {}, {})
	if html ~= nil then
		return html
	end

	return web.dev_error_html({
		_type = "error",
		err = {
			kind = err and err.kind or "template_error",
			message = err and err.message or "Fragment render failed",
		},
		action = "render_fragment",
		line = err and err.line or nil,
		expr = err and err.snippet or nil,
	})
end

return M
