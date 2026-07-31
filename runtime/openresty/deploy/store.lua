-- runtime/openresty/deploy/store.lua
-- SQLite-backed deployment store for explicit browser snapshot deploys.

local runtime_db = require("runtime.db")

local M = {}

local COLLECTION = "deployments"
local DEFAULT_DB_PATH = ".fuwa-dev/deployments.sqlite"

local function provider_path()
	if type(_G.__FUWA_DEPLOY_DB_PATH) == "string" and _G.__FUWA_DEPLOY_DB_PATH ~= "" then
		return _G.__FUWA_DEPLOY_DB_PATH
	end
	return os.getenv("FUWA_DEPLOY_DB_PATH") or DEFAULT_DB_PATH
end

local function make_provider()
	return runtime_db.new("sqlite_local", { path = provider_path() })
end

local function provider_response_value(response)
	if response and response.ok then
		return response.value
	end
	return nil
end

function M.save(slug, entry, source_files, compiled_files, session_id)
	local provider = make_provider()
	local existing = provider:op({
		op = "find",
		collection = COLLECTION,
		id = slug
	})

	local payload = {
		id = slug,
		slug = slug,
		entry = entry,
		source_files = source_files,
		compiled_files = compiled_files,
		session_id = session_id,
		deployed_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
	}

	if existing and existing.ok then
		local updated = provider:op({
			op = "update",
			collection = COLLECTION,
			id = slug,
			data = payload
		})
		assert(updated and updated.ok, "failed to update deployment " .. slug)
		return updated.value
	end

	local created = provider:op({
		op = "create",
		collection = COLLECTION,
		data = payload
	})
	assert(created and created.ok, "failed to create deployment " .. slug)
	return created.value
end

function M.load(slug)
	local provider = make_provider()
	local record = provider:op({
		op = "find",
		collection = COLLECTION,
		id = slug
	})
	return provider_response_value(record)
end

function M.list_by_session(session_id)
	local provider = make_provider()
	local response = provider:op({
		op = "where",
		collection = COLLECTION,
		where = { session_id = session_id },
		order = { field = "updated_at", dir = "desc" },
		limit = 50
	})
	local rows = provider_response_value(response) or {}
	local results = {}
	for index, row in ipairs(rows) do
		results[index] = {
			slug = row.slug or row.id,
			entry = row.entry,
			created_at = row.deployed_at or row.created_at
		}
	end
	return results
end

return M
