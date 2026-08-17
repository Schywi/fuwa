local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")

local M = {}

local function count_line_number(source, offset)
	local prefix = source:sub(1, offset - 1)
	local line = 1
	for _ in prefix:gmatch("\n") do
		line = line + 1
	end
	return line
end

local function expand_includes(source, source_files, filename, diagnostics_out, include_stack)
	if not source_files then
		return source
	end

	local out = {}
	local position = 1

	while true do
		local start_pos, end_pos, include_path = source:find('<include%s+src="([^"]+)"%s*/>', position)
		if not start_pos then
			out[#out + 1] = source:sub(position)
			break
		end

		out[#out + 1] = source:sub(position, start_pos - 1)
		local line = count_line_number(source, start_pos)
		local include_source = source_files[include_path]
		if include_source == nil then
			diagnostics.add(
				diagnostics_out,
				filename,
				line,
				string.format("Missing view fragment %s", strings.quote_lua_string(include_path)),
				source:sub(start_pos, end_pos)
			)
			return nil
		end

		if include_stack[include_path] then
			diagnostics.add(
				diagnostics_out,
				filename,
				line,
				string.format("Recursive view fragment include %s", strings.quote_lua_string(include_path)),
				source:sub(start_pos, end_pos)
			)
			return nil
		end

		include_stack[include_path] = true
		local expanded = expand_includes(include_source, source_files, include_path, diagnostics_out, include_stack)
		include_stack[include_path] = nil
		if expanded == nil then
			return nil
		end

		out[#out + 1] = expanded
		position = end_pos + 1
	end

	return table.concat(out)
end

local function fragment_name(key)
	return (key:gsub("^views/", ""):gsub("%.fuwa$", ""))
end

-- Fragments are the reusable partials under views/fragments/**. They become
-- named, standalone-renderable templates (e.g. "fragments/counter") so actions
-- can return them directly for HTMX partial swaps. Other views/ files stay
-- structural (used only through <include>).
local function collect_fragment_keys(source_files)
	local keys = {}
	if source_files then
		for key in pairs(source_files) do
			if type(key) == "string" and key:match("^views/fragments/.+%.fuwa$") then
				keys[#keys + 1] = key
			end
		end
	end
	table.sort(keys)
	return keys
end

-- Compile the single renderable `view` module as a name-keyed registry:
-- "__page__" is the whole-page template (view.fuwa, includes expanded) and the
-- default for any unknown name (so `render "home"` still renders the page);
-- each fragment is registered under its `fragments/<name>` key.
function M.compile_view_module(template_source, source_files, filename)
	local diagnostics_out = {}
	local page_template = expand_includes(template_source or "", source_files, filename or "view.fuwa", diagnostics_out, {})

	local fragments = {}
	for _, key in ipairs(collect_fragment_keys(source_files)) do
		local expanded = expand_includes(source_files[key], source_files, key, diagnostics_out, {})
		if expanded ~= nil then
			fragments[#fragments + 1] = { name = fragment_name(key), template = expanded }
		end
	end

	if page_template == nil or diagnostics.has_errors(diagnostics_out) then
		return {
			lua = nil,
			diagnostics = diagnostics_out
		}
	end

	local template_entries = {
		"  [" .. strings.quote_lua_string("__page__") .. "] = " .. strings.quote_lua_string(page_template) .. ","
	}
	for _, fragment in ipairs(fragments) do
		template_entries[#template_entries + 1] = "  ["
			.. strings.quote_lua_string(fragment.name)
			.. "] = "
			.. strings.quote_lua_string(fragment.template)
			.. ","
	end

	return {
		lua = table.concat({
			'local view = require("runtime.stdlib.view")',
			'local web = require("runtime.stdlib.web")',
			"",
			"local M = {}",
			"",
			"local templates = {",
			table.concat(template_entries, "\n"),
			"}",
			"",
			"function M.render(name, data, opts)",
			"  local template = templates[name]",
			"  if template == nil then",
			'    if type(name) == "string" and name:match("^fragments/") then',
			"      return web.dev_error_html({",
			'        _type = "error",',
			"        err = {",
			'          kind = "unknown_fragment",',
			'          message = "Unknown fragment: " .. tostring(name),',
			"        },",
			"        action = name,",
			"      })",
			"    end",
			'    template = templates["__page__"]',
			"  end",
			"",
			"  local html, err = view.render(template, data, opts)",
			"  if html ~= nil then",
			"    return html",
			"  end",
			"",
			"  return web.dev_error_html({",
			'    _type = "error",',
			"    err = {",
			'      kind = err and err.kind or "template_error",',
			'      message = err and err.message or "Template render failed",',
			"    },",
			"    action = name,",
			"    line = err and err.line or nil,",
			"    expr = err and err.snippet or nil,",
			"  })",
			"end",
			"",
			"return M",
			""
		}, "\n"),
		diagnostics = diagnostics_out
	}
end

return M
