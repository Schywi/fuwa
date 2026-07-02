local helper = require("tests.unit.compiler._helpers")
local view = require("runtime.stdlib.compiler.view")

return function(t)
	t.test("compile_view_source and compile_view_module emit runtime.stdlib imports", function()
		local source = "<main>&title</main>"
		local via_helper = helper.compile_view(source)
		local direct = view.compile_view_module(source)

		t.eq(via_helper, direct)
		t.contains(direct, 'local view = require("runtime.stdlib.view")')
		t.contains(direct, 'local web = require("runtime.stdlib.web")')
		t.contains(direct, 'local template = "<main>&title</main>"')
		t.contains(direct, "function M.render(name, data, opts)")
	end)
end
