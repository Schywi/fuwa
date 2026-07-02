local db = require("runtime.db")

local function cleanup_temp_db(path)
	os.remove(path)
	os.remove(path .. "-journal")
	os.remove(path .. "-wal")
	os.remove(path .. "-shm")
end

local function with_temp_provider(fn)
	local path = os.tmpname() .. ".sqlite"
	local provider = db.new("sqlite_local", { path = path })
	local ok, err = pcall(fn, provider)
	cleanup_temp_db(path)
	assert(ok, err)
end

return function(t)
	t.test("sqlite_local provider round trips and enforces uniqueness", function()
		with_temp_provider(function(provider)
			local created = provider:op({
				op = "create",
				collection = "wallets",
				data = {
					id = "wallet-1",
					title = "Primary",
					created_at = "should-be-stripped",
					updated_at = "should-be-stripped"
				}
			})

			t.truthy(created.ok, "expected create to succeed")
			t.eq(created.value.id, "wallet-1", "expected explicit id to be preserved")
			t.eq(created.value.title, "Primary", "expected payload field")

			local duplicate = provider:op({
				op = "create",
				collection = "wallets",
				data = {
					id = "wallet-1",
					title = "Secondary"
				}
			})
			t.falsy(duplicate.ok, "expected duplicate create to fail")
			t.eq(duplicate.err.kind, "already_exists", "expected duplicate error kind")

			local updated = provider:op({
				op = "update",
				collection = "wallets",
				id = "wallet-1",
				data = {
					title = "Updated"
				}
			})
			t.truthy(updated.ok, "expected update to succeed")
			t.eq(updated.value.title, "Updated", "expected updated value")

			local found = provider:op({
				op = "find",
				collection = "wallets",
				id = "wallet-1"
			})
			t.truthy(found.ok, "expected find to succeed")
			t.eq(found.value.title, "Updated", "expected persisted update")

			local deleted = provider:op({
				op = "delete",
				collection = "wallets",
				id = "wallet-1"
			})
			t.truthy(deleted.ok, "expected delete to succeed")

			local missing = provider:op({
				op = "find",
				collection = "wallets",
				id = "wallet-1"
			})
			t.falsy(missing.ok, "expected deleted row to be missing")
			t.eq(missing.err.kind, "not_found", "expected missing row kind")
		end)
	end)
end
