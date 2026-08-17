local strings = require("runtime.stdlib.compiler.strings")

return function(t)
	t.test("trim strips outer whitespace", function()
		t.eq(strings.trim("  hello \n"), "hello")
	end)

	t.test("quote_lua_string escapes control characters", function()
		local value = 'a"b\\c' .. string.char(8) .. "\n\t\f"
		t.eq(strings.quote_lua_string(value), '"a\\"b\\\\c\\b\\n\\t\\f"')
	end)

	t.test("interpolate_lua_expression lowers string interpolation", function()
		t.eq(
			strings.interpolate_lua_expression('"hello #{name}!"'),
			'"hello " .. tostring(name) .. "!"'
		)
	end)

	t.test("reserved words are recognized", function()
		t.truthy(strings.is_reserved_word("if"))
		t.falsy(strings.is_reserved_word("title"))
	end)

	t.test("key value parsing keeps expressions intact", function()
		t.eq(
			strings.parse_key_value_args('title: "hello", count: 1, ok: true'),
			'{ title = "hello", count = 1, ok = true }'
		)
		t.falsy(strings.parse_key_value_args("broken pair"))
	end)

	t.test("default parsing and formatting preserve primitive values", function()
		t.eq(strings.parse_default_value("10"), 10)
		t.eq(strings.parse_default_value("true"), true)
		t.eq(strings.parse_default_value('"hello"'), "hello")
		t.eq(strings.format_default_value("hello"), '"hello"')
		t.eq(strings.format_default_value(12), "12")
	end)

	t.test("module paths convert to require paths", function()
		t.eq(strings.module_path_to_require_path("pages/home"), "pages.home")
		t.truthy(strings.starts_with("render \"home\"", "render "))
	end)
end
