local provider = require("runtime.db.provider")

return function(t)
	t.test("helper responses match the documented shape", function()
		local ok_response = provider.ok({ answer = 42 })
		t.truthy(ok_response.ok, "expected ok response")
		t.eq(ok_response.value.answer, 42, "expected wrapped value")

		local err_response = provider.err("invalid_command", "bad collection", { collection = "bad-name" })
		t.falsy(err_response.ok, "expected error response")
		t.eq(err_response.err.kind, "invalid_command", "expected error kind")
		t.eq(err_response.err.message, "bad collection", "expected error message")
		t.eq(err_response.err.meta.collection, "bad-name", "expected error meta")
	end)

	t.test("collection names are validated", function()
		t.truthy(provider.is_valid_collection_name("wallets"), "expected valid collection name")
		t.truthy(provider.is_valid_collection_name("user_profiles"), "expected valid collection name")
		t.falsy(provider.is_valid_collection_name("bad-name"), "expected invalid collection name")
		t.falsy(provider.is_valid_collection_name("123bad"), "expected invalid collection name")
	end)

	t.test("reserved fields are stripped from payloads", function()
		local payload = provider.strip_reserved_fields({
			id = "row-1",
			created_at = "2024-01-01T00:00:00Z",
			updated_at = "2024-01-02T00:00:00Z",
			title = "Hello"
		})

		t.same(payload, {
			title = "Hello"
		}, "expected reserved fields to be removed")
	end)
end
