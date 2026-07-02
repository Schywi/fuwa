local db = require("runtime.db")

return function(t)
	t.test("db_op delegates to the selected provider", function()
		local calls = 0
		db.set_provider({
			op = function(_, command)
				calls = calls + 1
				return {
					ok = true,
					value = {
						op = command.op,
						collection = command.collection
					}
				}
			end
		})

		local response = db.db_op({
			op = "ping",
			collection = "wallets"
		})

		t.truthy(response.ok, "expected delegated response")
		t.eq(response.value.op, "ping", "expected delegated op")
		t.eq(response.value.collection, "wallets", "expected delegated collection")
		t.eq(calls, 1, "expected one provider call")
		db.reset()
	end)
end
