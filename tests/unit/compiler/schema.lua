local schema = require("runtime.stdlib.compiler.schema")
local helper = require("tests.unit.compiler._helpers")

return function(t)
	t.test("schema blocks emit field flags, defaults, changes and timestamps", function()
		local ctx = helper.context([[
module State

schema "gomen_state" do
  field key: string required unique
  field count: integer default 0
  field active: boolean default true
  timestamps
  change create do
    accept key, count, active
    require key
  end
end
]], "state.fuwa")
		ctx.module_name = "State"

		local next_index = schema.compile_schema_block(ctx, 4, "gomen_state")

		t.eq(next_index, 13)
		t.eq(#ctx.diagnostics, 0)
		local lua = helper.join(ctx.out)
		t.contains(lua, 'return schema.model("State", "gomen_state", {')
		t.contains(lua, 'schema.field("key", "string", { required = true, unique = true }),')
		t.contains(lua, 'schema.field("count", "integer", { default = 0 }),')
		t.contains(lua, 'schema.field("active", "boolean", { default = true }),')
		t.contains(lua, "schema.timestamps(),")
		t.contains(lua, 'schema.change("create", {')
		t.contains(lua, 'accept = { "key", "count", "active" },')
		t.contains(lua, 'require = { "key" },')
	end)

	t.test("schema blocks report malformed lines", function()
		local ctx = helper.context([[
module Broken

schema "broken_table" do
  nope
end
]], "broken.fuwa")
		ctx.module_name = "Broken"

		schema.compile_schema_block(ctx, 4, "broken_table")

		t.truthy(#ctx.diagnostics > 0)
		t.contains(ctx.diagnostics[1].message, "Expected: field name")
	end)
end
