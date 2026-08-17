local lines = require("runtime.stdlib.compiler.lines")

return function(t)
	t.test("split normalizes line endings", function()
		t.same(lines.split("a\r\nb\rc\n"), { "a", "b", "c", "" })
	end)

	t.test("blank and comment detection matches the compiler contract", function()
		t.truthy(lines.is_blank_or_comment(""))
		t.truthy(lines.is_blank_or_comment("   "))
		t.truthy(lines.is_blank_or_comment("-- note"))
		t.falsy(lines.is_blank_or_comment("render \"home\""))
	end)
end
