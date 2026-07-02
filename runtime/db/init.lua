local memory = require("runtime.db.providers.memory")
local log = require("runtime.log")

local M = {}

local current_provider = memory.new()
local current_provider_name = current_provider.__name or "memory"

function M.set_provider(provider)
	current_provider = assert(provider, "DB provider is required")
	current_provider_name = current_provider.__name or "custom"
	log.log("db", "provider", {
		provider = current_provider_name,
	})
end

function M.reset()
	current_provider = memory.new()
	current_provider_name = current_provider.__name or "memory"
	log.log("db", "provider", {
		provider = current_provider_name,
	})
end

function M.db_op(command)
	command = command or {}
	log.log("db", "dispatch", {
		collection = command.collection,
		op = command.op,
		provider = current_provider_name,
	})

	local response = current_provider:op(command)
	if response and response.ok then
		local result = response.value
		log.log("db", "ok", {
			collection = command.collection,
			id = type(result) == "table" and result.id or nil,
			op = command.op,
			provider = current_provider_name,
		})
	else
		local err = response and response.err or {}
		log.log("db", "err", {
			collection = command.collection,
			kind = err.kind,
			op = command.op,
			provider = current_provider_name,
		})
	end

	return response
end

function M.new(provider_name, opts)
	if provider_name == nil or provider_name == "memory" then
		return memory.new(opts)
	end

	if provider_name == "sqlite_local" then
		return require("runtime.db.providers.sqlite_local").new(opts)
	end

	error("Unknown DB provider: " .. tostring(provider_name))
end

return M
