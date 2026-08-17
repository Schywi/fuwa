local memory = require("runtime.db.providers.memory")

local function make_clock(stamps)
	local index = 0
	return function()
		index = index + 1
		return stamps[index] or stamps[#stamps]
	end
end

local function create_row(provider, collection, data)
	return provider:op({
		op = "create",
		collection = collection,
		data = data
	})
end

local function get_values(rows, field)
	local values = {}
	for index, row in ipairs(rows or {}) do
		values[index] = row[field]
	end
	return values
end

return function(t)
	t.test("create and find round trip", function()
		local provider = memory.new({
			now = make_clock({
				"2025-01-01T00:00:01Z"
			})
		})

		local created = create_row(provider, "wallets", {
			id = "wallet-1",
			title = "Primary",
			created_at = "should-be-stripped",
			updated_at = "should-be-stripped"
		})

		t.truthy(created.ok, "expected create to succeed")
		t.eq(created.value.id, "wallet-1", "expected explicit id to be preserved")
		t.eq(created.value.title, "Primary", "expected payload field")
		t.eq(created.value.created_at, "2025-01-01T00:00:01Z", "expected created_at")
		t.eq(created.value.updated_at, "2025-01-01T00:00:01Z", "expected updated_at")
		t.falsy(created.value.created_at == "should-be-stripped", "expected reserved fields to be regenerated")

		local found = provider:op({
			op = "find",
			collection = "wallets",
			id = "wallet-1"
		})

		t.truthy(found.ok, "expected find to succeed")
		t.same(found.value, created.value, "expected round-trip row")
	end)

	t.test("duplicate ids are rejected", function()
		local provider = memory.new()

		local first = create_row(provider, "wallets", {
			id = "wallet-1",
			title = "Primary"
		})
		t.truthy(first.ok, "expected create to succeed")

		local duplicate = create_row(provider, "wallets", {
			id = "wallet-1",
			title = "Secondary"
		})

		t.falsy(duplicate.ok, "expected duplicate create to fail")
		t.eq(duplicate.err.kind, "already_exists", "expected collision error kind")
	end)

	t.test("update and delete report missing rows", function()
		local provider = memory.new()

		local update_missing = provider:op({
			op = "update",
			collection = "wallets",
			id = "missing",
			data = { title = "Nope" }
		})
		t.falsy(update_missing.ok, "expected update to fail")
		t.eq(update_missing.err.kind, "not_found", "expected update not_found")

		local delete_missing = provider:op({
			op = "delete",
			collection = "wallets",
			id = "missing"
		})
		t.falsy(delete_missing.ok, "expected delete to fail")
		t.eq(delete_missing.err.kind, "not_found", "expected delete not_found")
	end)

	t.test("where filtering honors limit", function()
		local provider = memory.new({
			now = make_clock({
				"2025-01-01T00:00:01Z",
				"2025-01-01T00:00:02Z",
				"2025-01-01T00:00:03Z"
			})
		})

		create_row(provider, "wallets", {
			id = "wallet-1",
			kind = "alpha",
			name = "Alpha"
		})
		create_row(provider, "wallets", {
			id = "wallet-2",
			kind = "beta",
			name = "Beta"
		})
		create_row(provider, "wallets", {
			id = "wallet-3",
			kind = "beta",
			name = "Gamma"
		})

		local filtered = provider:op({
			op = "where",
			collection = "wallets",
			where = { kind = "beta" },
			limit = 1
		})

		t.truthy(filtered.ok, "expected where to succeed")
		t.eq(#filtered.value, 1, "expected limit to apply")
		t.eq(filtered.value[1].id, "wallet-3", "expected default ordering by updated_at desc")
	end)

	t.test("find_by returns the first matching row", function()
		local provider = memory.new({
			now = make_clock({
				"2025-01-01T00:00:01Z",
				"2025-01-01T00:00:02Z"
			})
		})

		create_row(provider, "wallets", {
			id = "wallet-1",
			status = "draft",
			name = "First"
		})
		create_row(provider, "wallets", {
			id = "wallet-2",
			status = "draft",
			name = "Second"
		})

		local found = provider:op({
			op = "find_by",
			collection = "wallets",
			where = { status = "draft" }
		})

		t.truthy(found.ok, "expected find_by to succeed")
		t.eq(found.value.id, "wallet-2", "expected first match after default ordering")
	end)

	t.test("all honors ordering and limit", function()
		local provider = memory.new({
			now = make_clock({
				"2025-01-01T00:00:01Z",
				"2025-01-01T00:00:02Z",
				"2025-01-01T00:00:03Z"
			})
		})

		create_row(provider, "wallets", {
			id = "wallet-c",
			name = "Charlie"
		})
		create_row(provider, "wallets", {
			id = "wallet-a",
			name = "Alpha"
		})
		create_row(provider, "wallets", {
			id = "wallet-b",
			name = "Bravo"
		})

		local ordered = provider:op({
			op = "all",
			collection = "wallets",
			order = "name",
			limit = 2
		})

		t.truthy(ordered.ok, "expected all to succeed")
		t.eq(#ordered.value, 2, "expected limit to apply")
		t.same(get_values(ordered.value, "id"), {
			"wallet-a",
			"wallet-b"
		}, "expected order by name asc")
	end)
end
