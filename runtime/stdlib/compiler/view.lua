local strings = require("runtime.stdlib.compiler.strings")

local M = {}

function M.compile_view_module(template_source)
	local quoted_template = strings.quote_lua_string(template_source or "")

	return table.concat({
		'local view = require("fuwa.runtime.view")',
		'local web = require("fuwa.runtime.web")',
		"",
		"local M = {}",
		"",
		"local template = " .. quoted_template,
		"",
		"function M.render(name, data, opts)",
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
	}, "\n")
end

return M
