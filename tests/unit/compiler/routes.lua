local routes = require("runtime.stdlib.compiler.routes")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("route blocks emit web.app with imported handlers", function()
		local ctx = helper.context([[
module App

routes do
  GET "/" Home.index
  POST "/save" Home.save
end
]], "app.fuwa")
		ctx.imports = {
			{ alias = "Home", path = "pages/home" }
		}

		local next_index = routes.compile_routes_block(ctx, 4)

		t.eq(next_index, 7)
		t.eq(#ctx.diagnostics, 0)
		local lua = helper.join(ctx.out)
		t.contains(lua, 'local Home = require("pages.home")')
		t.contains(lua, 'return web.app({')
		t.contains(lua, 'web.GET("/", Home.index),')
		t.contains(lua, 'web.POST("/save", Home.save),')
	end)

	t.test("route blocks report malformed routes", function()
		local ctx = helper.context([[
routes do
  GET / Home.index
end
]], "routes.fuwa")

		routes.compile_routes_block(ctx, 2)

		t.truthy(#ctx.diagnostics > 0)
		t.contains(helper.format_diagnostics(ctx.diagnostics), 'Expected string')
	end)
end
