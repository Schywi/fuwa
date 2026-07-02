local compiler = require("runtime.stdlib.compiler")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("compile_runtime_files expands split view fragments", function()
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
end
]],
			["view.fuwa"] = [[
<include src="views/layout.fuwa" />
]],
			["views/layout.fuwa"] = [[
<html>
  <body>
    <include src="views/home.fuwa" />
  </body>
</html>
]],
			["views/home.fuwa"] = [[
<main>&title</main>
]]
		})

		t.eq(#result.diagnostics, 0)
		t.truthy(result.modules["view.lua"] ~= nil)
		t.falsy(result.modules["views/layout.lua"] ~= nil)
		t.falsy(result.modules["views/home.lua"] ~= nil)
		t.contains(result.modules["view.lua"], "<html>")
		t.contains(result.modules["view.lua"], "<main>&title</main>")
		t.falsy(result.modules["view.lua"]:find("<include", 1, true))
	end)

	t.test("compile_runtime_files reports missing view fragments", function()
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
end
]],
			["view.fuwa"] = [[
<include src="views/layout.fuwa" />
]]
		})

		t.truthy(#result.diagnostics > 0)
		t.falsy(result.modules["view.lua"] ~= nil)
		t.contains(helper.format_diagnostics(result.diagnostics), "Missing view fragment")
	end)
end
