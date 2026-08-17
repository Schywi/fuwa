local responses = require("runtime.stdlib.compiler.responses")

return function(t)
	t.test("parse_render emits a render call", function()
		t.eq(
			responses.parse_render('render "home/index", title: "hello", count: 1'),
			'render("home/index", { title = "hello", count = 1 })'
		)
	end)

	t.test("parse_redirect interpolates expressions", function()
		t.eq(
			responses.parse_redirect('redirect "/users/#{id}"'),
			'redirect("/users/" .. tostring(id))'
		)
	end)

	t.test("parse_fail supports atoms and expression failures", function()
		t.eq(
			responses.parse_fail('fail :missing, reason: "oops"'),
			'fail("missing", { reason = "oops" })'
		)
		t.eq(
			responses.parse_fail('fail err, code: 404'),
			'fail(err, { code = 404 })'
		)
	end)

	t.test("apply_response_expr lowers render and redirect expressions", function()
		t.eq(responses.apply_response_expr('render "home"'), 'render("home", {})')
		t.eq(responses.apply_response_expr('redirect "/home"'), 'redirect("/home")')
		t.eq(responses.apply_response_expr('fail err'), 'fail(err)')
	end)
end
