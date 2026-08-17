local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("package_web.build emits runnable files and passthrough assets", function()
		local result = helper.package_web({
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
]],
			["hooks/client.js"] = "console.log('hello')"
		})

		t.eq(#result.diagnostics, 0)
		t.truthy(result.run_files["main.lua"] ~= nil)
		t.truthy(result.run_files["app.lua"] ~= nil)
		t.truthy(result.run_files["pages/home.lua"] ~= nil)
		t.truthy(result.run_files["view.lua"] ~= nil)
		t.falsy(result.run_files["views/layout.lua"] ~= nil)
		t.falsy(result.run_files["views/home.lua"] ~= nil)
		t.eq(result.run_files["hooks/client.js"], "console.log('hello')")
		t.contains(result.run_files["main.lua"], "function handle_request(method, path, body)")
		t.contains(result.run_files["main.lua"], 'local web = require("runtime.stdlib.web")')
	end)

	t.test("package_web.build reports missing view.fuwa and omits main.lua", function()
		local result = helper.package_web({
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
]]
		})

		t.truthy(#result.diagnostics > 0)
		t.falsy(result.run_files["main.lua"] ~= nil)
		t.contains(helper.format_diagnostics(result.diagnostics), "Missing view.fuwa template file")
	end)
end
