local actions = require("runtime.stdlib.compiler.actions")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("action blocks lower guard, assignment and render/redirect sugar", function()
		local ctx = helper.context([[
action index(req) do
  if req.ok -> redirect "/"
  count = 1
  render "home", title: "hello"
  redirect "/done"
end
]], "action.fuwa")

		local next_index = actions.compile_action_block(ctx, 2, "index", "req")

		t.eq(next_index, 7)
		t.eq(#ctx.diagnostics, 0)
		local lua = helper.join(ctx.out)
		t.contains(lua, "local web = require(\"runtime.stdlib.web\")")
		t.contains(lua, "local render = web.render")
		t.contains(lua, "function M.index(req)")
		t.contains(lua, "if req.ok  then")
		t.contains(lua, "return redirect(\"/\")")
		t.contains(lua, "local count = 1")
		t.contains(lua, "return render(\"home\", { title = \"hello\" })")
		t.contains(lua, "return redirect(\"/done\")")
	end)

	t.test("action blocks lower match and question-mark sugar", function()
		local ctx = helper.context([[
action index(req) do
  row = State.find_by({ key = "main" })?
  match mood do
    when "happy" -> render "home", title: "yay"
    else -> fail :missing_mood, reason: "unknown"
  end
end
]], "action.fuwa")
		ctx.imports = {
			{ alias = "State", path = "models/state" }
		}

		actions.compile_action_block(ctx, 2, "index", "req")

		t.eq(#ctx.diagnostics, 0)
		local lua = helper.join(ctx.out)
		t.contains(lua, 'local State = require("models.state")')
		t.contains(lua, 'local __r_row = State.find_by({ key = "main" })')
		t.contains(lua, 'return fail(__r_row.err, {')
		t.contains(lua, 'if mood == "happy" then')
		t.contains(lua, 'return render("home", { title = "yay" })')
		t.contains(lua, 'return fail("missing_mood", { reason = "unknown" })')
	end)

	t.test("action blocks report unexpected EOF", function()
		local ctx = helper.context([[
action index(req) do
  render "home"
]], "broken_action.fuwa")

		actions.compile_action_block(ctx, 2, "index", "req")

		t.truthy(#ctx.diagnostics > 0)
		t.contains(ctx.diagnostics[1].message, "Unexpected EOF while parsing action block")
	end)
end
