local compiler = require("runtime.stdlib.compiler")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("compile_runtime_files emits lua modules for a minimal happy path", function()
		local result = compiler.compile_runtime_files({
			["app.fuwa"] = [[
module App

import
  Home "pages/home"
end

routes do
  GET "/" Home.index
end
]],
			["pages/home.fuwa"] = [[
module Home

action index(req) do
  render "home", title: "hello"
end
]],
			["view.fuwa"] = [[
<main>&title</main>
]]
		})

		t.eq(#result.diagnostics, 0)
		t.truthy(result.modules["app.lua"] ~= nil)
		t.truthy(result.modules["pages/home.lua"] ~= nil)
		t.truthy(result.modules["view.lua"] ~= nil)
		t.contains(result.modules["app.lua"], 'return web.app({')
		t.contains(result.modules["pages/home.lua"], 'function M.index(req)')
		t.contains(result.modules["view.lua"], "<main>&title</main>")
		t.eq(
			helper.format_diagnostics(result.diagnostics),
			""
		)
	end)

	t.test("compile_view_source emits runtime.stdlib imports", function()
		local lua = helper.compile_view("<main>&title</main>")

		t.contains(lua, 'local view = require("runtime.stdlib.view")')
		t.contains(lua, 'local web = require("runtime.stdlib.web")')
		t.contains(lua, 'local template = "<main>&title</main>"')
		t.contains(lua, "return web.dev_error_html({")
	end)

	t.test("compile_runtime_files keeps good modules and reports broken ones", function()
		local result = compiler.compile_runtime_files({
			["app.fuwa"] = [[
module App

routes do
  GET "/" Home.index
end
]],
			["pages/home.fuwa"] = [[
module Home

action index(req) do
  render "home", title: "hello"
]],
			["view.fuwa"] = [[
<main>&title</main>
]]
		})

		t.truthy(#result.diagnostics > 0)
		t.truthy(result.modules["app.lua"] ~= nil)
		t.falsy(result.modules["pages/home.lua"] ~= nil)
		t.truthy(result.modules["view.lua"] ~= nil)
	end)

	t.test("format_build_diagnostics stays readable", function()
		local text = compiler.format_build_diagnostics({
			{
				level = "error",
				file = "pages/home.fuwa",
				line = 4,
				message = "Unexpected EOF while parsing action block",
				snippet = "  render \"home\""
			}
		})

		t.contains(text, "pages/home.fuwa:4")
		t.contains(text, "Unexpected EOF while parsing action block")
		t.contains(text, "render \"home\"")
	end)
end
