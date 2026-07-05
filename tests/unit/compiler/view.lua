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

	t.test("compile_runtime_files registers fragments as standalone renderables", function()
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
  render "home", count: 1
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
<main>
  <include src="views/fragments/counter.fuwa" />
</main>
]],
			["views/fragments/counter.fuwa"] = [[
<section id="counter">Clicks: &count</section>
]]
		})

		t.eq(#result.diagnostics, 0)
		local src = result.modules["view.lua"]
		t.truthy(src ~= nil)
		-- fragments are inlined into the registry, not emitted as their own module
		t.falsy(result.modules["views/fragments/counter.lua"] ~= nil)
		t.contains(src, '["__page__"]')
		t.contains(src, '["fragments/counter"]')

		local view_mod = helper.load_chunk(src)()

		-- fragment renders standalone: just the section, no page wrapper
		local frag = view_mod.render("fragments/counter", { count = 5 }, {})
		t.contains(frag, '<section id="counter">Clicks: 5</section>')
		t.falsy(frag:find("<html", 1, true))

		-- page still renders the whole document with the inlined fragment
		local page = view_mod.render("home", { count = 9 }, {})
		t.truthy(page:find("<html", 1, true) ~= nil)
		t.contains(page, 'id="counter"')

		-- unknown fragment name -> dev error, never the whole page
		local unknown = view_mod.render("fragments/nope", {}, {})
		t.falsy(unknown:find("<html", 1, true))
		t.contains(unknown, "Unknown fragment")

		-- bindings are HTML-escaped (no raw-string injection)
		local escaped = view_mod.render("fragments/counter", { count = "<b>x</b>" }, {})
		t.falsy(escaped:find("<b>x</b>", 1, true))
		t.contains(escaped, "&lt;b&gt;")
	end)
end
