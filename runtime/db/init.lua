local memory = require("runtime.db.providers.memory")

local M = {}

local current_provider = memory.new()

function M.set_provider(provider)
	current_provider = assert(provider, "DB provider is required")
end

function M.reset()
	current_provider = memory.new()
end

function M.db_op(command)
	return current_provider:op(command)
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
