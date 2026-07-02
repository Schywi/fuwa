local db = require("runtime.db")
local trace = require("runtime.trace")

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

local function capture_trace(spec, fn)
	local events = {}
	trace.configure({
		sink = function(event)
			events[#events + 1] = event
		end,
		trace = spec,
	})

	local ok, err = pcall(fn, events)
	trace.reset()
	assert(ok, err)
	return events
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

	t.test("sqlite_local telemetry includes helper dispatch and return", function()
		with_temp_provider(function(provider)
			local events = capture_trace("db", function()
				db.set_provider(provider)
				local ok, err = pcall(function()
					local response = db.db_op({
						op = "create",
						collection = "wallets",
						data = {
							title = "Primary"
						}
					})
					t.truthy(response.ok, "expected db dispatch to succeed")
				end)
				db.reset()
				assert(ok, err)
			end)

			t.eq(events[1].kind, "span_start", "expected db.dispatch start")
			t.eq(events[1].name, "db.dispatch", "expected db.dispatch span")
			t.eq(events[2].kind, "span_start", "expected sqlite_local start")
			t.eq(events[2].name, "db.sqlite_local", "expected sqlite_local span")
			t.eq(events[2].attrs.path:match("sqlite"), "sqlite", "expected sqlite path attribute")
			t.eq(events[3].kind, "span_log", "expected helper dispatch log")
			t.eq(events[3].message, "helper dispatch", "expected helper dispatch message")
			t.eq(events[4].kind, "span_log", "expected helper return log")
			t.eq(events[4].fields.ok, true, "expected helper return ok")
			t.eq(events[5].kind, "span_end", "expected sqlite_local end")
			t.truthy(events[5].attrs.saved, "expected sqlite_local saved attr")
			t.eq(events[6].kind, "span_end", "expected db.dispatch end")
			t.truthy(events[6].attrs.ok, "expected db.dispatch ok attr")
		end)
	end)
end
