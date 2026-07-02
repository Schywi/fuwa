local provider = require("runtime.db.provider")
local trace = require("runtime.trace")

local M = {}

local function ensure_state(state)
	state = state or {}
	state.collections = state.collections or {}
	return state
end

local function ensure_collection(state, name)
	local collection = state.collections[name]
	if type(collection) ~= "table" then
		collection = {}
		state.collections[name] = collection
	end
	return collection
end

local function collection_size(collection)
	local count = 0
	for _ in pairs(collection or {}) do
		count = count + 1
	end
	return count
end

local function normalize_id(value)
	if value == nil then
		return nil
	end

	local text = tostring(value)
	if text == "" then
		return nil
	end

	return text
end

local function collection_rows(collection)
	local rows = {}
	for _, row in pairs(collection or {}) do
		if type(row) == "table" then
			rows[#rows + 1] = provider.clone(row)
		end
	end
	return rows
end

local function response_invalid_collection(collection)
	return provider.err("invalid_command", "Invalid collection name", {
		collection = collection
	})
end

local function response_invalid_command(message)
	return provider.err("invalid_command", message)
end

local function response_not_found(collection, id)
	return provider.err("not_found", string.format("Document %s not found in %s", tostring(id), tostring(collection)), {
		collection = collection,
		id = id
	})
end

local function row_by_id(collection, id)
	local normalized = normalize_id(id)
	if normalized == nil then
		return nil
	end

	return collection[normalized], normalized
end

function M.new(opts)
	opts = opts or {}
	local state = ensure_state(provider.clone(opts.state or {}))
	local now = opts.now

	local instance = {
		__name = "memory",
	}

	function instance:op(command)
		command = command or {}

		return trace.span("db.memory", {
			collection = command.collection,
			op = command.op,
		}, function(span)
			if not provider.is_valid_collection_name(command.collection) then
				return response_invalid_collection(command.collection)
			end

			local collection = ensure_collection(state, command.collection)
			local op = command.op

			if op == "all" then
				local rows = collection_rows(collection)
				local response = provider.ok(provider.filter_rows(rows, nil, command.order, command.limit))
				span:log("result", {
					rows = #response.value,
				})
				return response
			end

			if op == "find" then
				local row = row_by_id(collection, command.id)
				if row == nil then
					return response_not_found(command.collection, command.id)
				end
				span:log("hit", {
					id = row.id,
				})
				return provider.ok(provider.clone(row))
			end

			if op == "find_by" then
				if not provider.is_record(command.where) then
					return response_invalid_command("Missing where clause")
				end

				local row = provider.first_row(collection_rows(collection), command.where, command.order)
				if row == nil then
					return response_not_found(command.collection, "(where)")
				end
				span:log("hit", {
					id = row.id,
				})
				return provider.ok(row)
			end

			if op == "where" then
				if not provider.is_record(command.where) then
					return response_invalid_command("Missing where clause")
				end

				local rows = collection_rows(collection)
				local response = provider.ok(provider.filter_rows(rows, command.where, command.order, command.limit))
				span:log("result", {
					rows = #response.value,
				})
				return response
			end

			if op == "create" or op == "insert" then
				if not provider.is_record(command.data) then
					return response_invalid_command("Missing data payload")
				end

				local data = provider.strip_reserved_fields(command.data)
				local id = normalize_id(command.data.id) or provider.generate_id()
				if collection[id] ~= nil then
					return provider.err("already_exists", string.format("Document already exists in %s", command.collection), {
						collection = command.collection,
						id = id
					})
				end

				local timestamp = provider.now_iso(now)
				local row = {
					id = id,
					created_at = timestamp,
					updated_at = timestamp
				}
				for key, value in pairs(data) do
					row[key] = provider.clone(value)
				end

				collection[id] = row
				span:set("saved", true)
				span:set("rows", collection_size(collection))
				return provider.ok(provider.clone(row))
			end

			if op == "update" then
				local id = normalize_id(command.id)
				if id == nil or not provider.is_record(command.data) then
					return response_invalid_command("Missing id or data payload")
				end

				local row = collection[id]
				if row == nil then
					return response_not_found(command.collection, id)
				end

				local payload = provider.strip_reserved_fields(command.data)
				for key, value in pairs(payload) do
					row[key] = provider.clone(value)
				end
				row.updated_at = provider.now_iso(now)

				span:set("saved", true)
				span:set("rows", collection_size(collection))
				return provider.ok(provider.clone(row))
			end

			if op == "delete" then
				local id = normalize_id(command.id)
				if id == nil then
					return response_invalid_command("Missing document id")
				end

				if collection[id] == nil then
					return response_not_found(command.collection, id)
				end

				collection[id] = nil
				span:set("saved", true)
				span:set("rows", collection_size(collection))
				return provider.ok(true)
			end

			return response_invalid_command("Unsupported op " .. tostring(op))
		end)
	end

	return instance
end

return M
