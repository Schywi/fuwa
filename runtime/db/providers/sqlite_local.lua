local provider = require("runtime.db.provider")
local trace = require("runtime.trace")
local util = require("runtime.util")

local M = {}

local function escape_json_string(value)
	return tostring(value)
		:gsub("\\", "\\\\")
		:gsub('"', '\\"')
		:gsub("\b", "\\b")
		:gsub("\f", "\\f")
		:gsub("\n", "\\n")
		:gsub("\r", "\\r")
		:gsub("\t", "\\t")
end

local function encode_json(value)
	local value_type = type(value)
	if value == nil then
		return "null"
	end
	if value_type == "boolean" then
		return value and "true" or "false"
	end
	if value_type == "number" then
		return tostring(value)
	end
	if value_type == "string" then
		return string.format("%q", value):gsub("\\\n", "\\n")
	end
	if value_type ~= "table" then
		error("cannot encode type " .. value_type)
	end

	local array, count = util.is_array(value)
	local parts = {}

	if array then
		for index = 1, count do
			parts[#parts + 1] = encode_json(value[index])
		end
		return "[" .. table.concat(parts, ",") .. "]"
	end

	for key in pairs(value) do
		parts[#parts + 1] = key
	end
	table.sort(parts, function(left, right)
		return tostring(left) < tostring(right)
	end)

	local encoded = {}
	for _, key in ipairs(parts) do
		encoded[#encoded + 1] = string.format("%q:%s", tostring(key), encode_json(value[key]))
	end

	return "{" .. table.concat(encoded, ",") .. "}"
end

local function ensure_parent_dir(path)
	local parent = util.dirname(path)
	os.execute("mkdir -p " .. util.shell_quote(parent))
end

local script_source = debug.getinfo(1, "S").source
local script_path = script_source:sub(1, 1) == "@" and script_source:sub(2) or script_source
local helper_path = util.dirname(script_path) .. "/sqlite_local.py"

function M.new(opts)
	opts = opts or {}
	local db_path = tostring(opts.path or os.getenv("FUWA_DB_PATH") or ".fuwa-dev/sqlite-local.db")
	local python_bin = tostring(opts.python_bin or os.getenv("PYTHON_BIN") or "python3")

	local instance = {
		__name = "sqlite_local",
		__path = db_path,
	}

	function instance:op(command)
		command = command or {}

		return trace.span("db.sqlite_local", {
			collection = command.collection,
			op = command.op,
			path = db_path,
		}, function(span)
			if not provider.is_valid_collection_name(command.collection) then
				local response = provider.err("invalid_command", "Invalid collection name", {
					collection = command.collection
				})
				span:set("kind", response.err.kind)
				return response
			end

			ensure_parent_dir(db_path)

			local command_path = os.tmpname()
			util.write_all(command_path, encode_json(command))
			span:log("helper dispatch", {
				path = db_path,
			})

			local helper_command = table.concat({
				util.shell_quote(python_bin),
				util.shell_quote(helper_path),
				util.shell_quote(db_path),
				util.shell_quote(command_path)
			}, " ")

			local pipe = assert(io.popen(helper_command, "r"))
			local output = pipe:read("*a") or ""
			pipe:close()
			os.remove(command_path)

			local response_chunk, err = load("return " .. output, "@sqlite-local-response", "t", {})
			assert(response_chunk, err)
			local response = response_chunk()

			if response and response.ok then
				if command.op == "create" or command.op == "insert" or command.op == "update" or command.op == "delete" then
					span:set("saved", true)
				end
				span:log("helper return", {
					ok = true,
				})
			else
				local response_err = response and response.err or {}
				span:set("kind", response_err.kind)
				span:log("helper return", {
					ok = false,
					kind = response_err.kind,
				})
			end

			return response
		end)
	end

	return instance
end

return M
