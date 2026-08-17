local imports = require("runtime.stdlib.compiler.imports")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("parse_import_block collects aliases until end", function()
		local ctx = helper.context([[
import
  Home "pages/home"
  State "models/state"
end
]], "imports.fuwa")

		local next_index = imports.parse_import_block(ctx, 2)

		t.eq(next_index, 5)
		t.eq(#ctx.imports, 2)
		t.eq(ctx.imports[1].alias, "Home")
		t.eq(ctx.imports[1].path, "pages/home")
		t.eq(ctx.imports[2].alias, "State")
		t.eq(ctx.imports[2].path, "models/state")
	end)

	t.test("emit_imports writes stable require lines", function()
		local ctx = helper.context("", "imports.fuwa")
		ctx.imports = {
			{ alias = "Home", path = "pages/home" },
			{ alias = "State", path = "models/state" }
		}

		imports.emit_imports(ctx)

		t.eq(
			helper.join(ctx.out),
			'local Home = require("pages.home")\nlocal State = require("models.state")\n'
		)
		t.truthy(ctx.imports_emitted)
	end)
end
