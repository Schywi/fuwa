local result = require("runtime.stdlib.result")

local M = {}

local function deep_equal(left, right)
	if left == right then
		return true
	end

	if type(left) ~= type(right) then
		return false
	end

	if type(left) ~= "table" then
		return tostring(left) == tostring(right)
	end

	local left_count = 0
	for key, value in pairs(left) do
		left_count = left_count + 1
		if not deep_equal(value, right[key]) then
			return false
		end
	end

	local right_count = 0
	for _ in pairs(right) do
		right_count = right_count + 1
	end

	return left_count == right_count
end

local function clone(value)
	if type(value) ~= "table" then
		return value
	end

	local out = {}
	for key, entry in pairs(value) do
		out[clone(key)] = clone(entry)
	end
	return out
end

local function compare_values(left, right)
	if left == right then
		return 0
	end

	if left == nil then
		return -1
	end
	if right == nil then
		return 1
	end

	local left_type = type(left)
	local right_type = type(right)
	if left_type == "number" and right_type == "number" then
		if left < right then
			return -1
		end
		return 1
	end

	if left_type == "boolean" and right_type == "boolean" then
		local left_number = left and 1 or 0
		local right_number = right and 1 or 0
		if left_number < right_number then
			return -1
		end
		return 1
	end

	local left_text = tostring(left)
	local right_text = tostring(right)
	if left_text < right_text then
		return -1
	end
	return 1
end

function M.ok(value)
	return result.ok(value)
end

function M.err(kind, message, meta)
	return result.err(kind, message, meta)
end

function M.clone(value)
	return clone(value)
end

function M.is_record(value)
	return type(value) == "table"
end

function M.is_valid_collection_name(name)
	return type(name) == "string" and name:match("^[A-Za-z_][A-Za-z0-9_]*$") ~= nil
end

function M.strip_reserved_fields(data)
	local payload = {}
	if type(data) ~= "table" then
		return payload
	end

	for key, value in pairs(data) do
		if key ~= "id" and key ~= "created_at" and key ~= "updated_at" then
			payload[key] = clone(value)
		end
	end

	return payload
end

function M.values_equal(left, right)
	return deep_equal(left, right)
end

function M.row_matches(row, where)
	for key, expected in pairs(where or {}) do
		if not deep_equal(row[key], expected) then
			return false
		end
	end
	return true
end

function M.normalize_order(order)
	if type(order) == "string" then
		return {
			field = order,
			dir = "asc"
		}
	end

	if type(order) ~= "table" then
		return {
			field = "updated_at",
			dir = "desc"
		}
	end

	return {
		field = order.field or "updated_at",
		dir = order.dir == "asc" and "asc" or "desc"
	}
end

function M.sort_rows(rows, order)
	local normalized = M.normalize_order(order)
	local field = normalized.field or "updated_at"
	local direction = normalized.dir == "asc" and 1 or -1

	table.sort(rows, function(left, right)
		return direction * compare_values(left[field], right[field]) < 0
	end)

	return rows
end

function M.limit_rows(rows, limit)
	local max = 100
	if type(limit) == "number" and limit > 0 and limit == limit then
		max = math.floor(limit)
	end

	local out = {}
	for index = 1, math.min(#rows, max) do
		out[index] = clone(rows[index])
	end
	return out
end

function M.filter_rows(rows, where, order, limit)
	local matched = {}
	for _, row in ipairs(rows or {}) do
		if M.row_matches(row, where) then
			matched[#matched + 1] = clone(row)
		end
	end

	M.sort_rows(matched, order)
	return M.limit_rows(matched, limit)
end

function M.first_row(rows, where, order)
	local matched = M.filter_rows(rows, where, order, 1)
	return matched[1]
end

function M.now_iso(now_fn)
	if type(now_fn) == "function" then
		return tostring(now_fn())
	end

	return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

function M.generate_id()
	return string.format("doc_%d_%04d", os.time(), math.random(0, 9999))
end

return M
