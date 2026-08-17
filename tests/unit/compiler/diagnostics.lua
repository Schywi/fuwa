local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("adds and formats diagnostics", function()
		local entries = {}

		diagnostics.add(entries, "app.fuwa", 3, "Unexpected line", "  bad")

		t.eq(#entries, 1)
		t.truthy(diagnostics.has_errors(entries))

		local text = diagnostics.format(entries)
		t.contains(text, "app.fuwa:3")
		t.contains(text, "Unexpected line")
		t.contains(text, "bad")
	end)

	t.test("warning entries do not count as errors", function()
		local entries = {}

		diagnostics.add(entries, "app.fuwa", 1, "Heads up", nil, "warning")

		t.eq(#entries, 1)
		t.falsy(diagnostics.has_errors(entries))
		t.contains(helper.format_diagnostics(entries), "Heads up")
	end)
end
