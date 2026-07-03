local memory = require("runtime.db.providers.memory")
local trace = require("runtime.trace")

local M = {}

local current_provider = memory.new()
local current_provider_name = current_provider.__name or "memory"

function M.set_provider(provider)
	current_provider = assert(provider, "DB provider is required")
	current_provider_name = current_provider.__name or "custom"
end

function M.reset()
	current_provider = memory.new()
	current_provider_name = current_provider.__name or "memory"
end

function M.db_op(command)
	command = command or {}

	return trace.span("db.dispatch", {
		collection = command.collection,
		op = command.op,
		provider = current_provider_name,
	}, function(span)
		local response = current_provider:op(command)
		if response and response.ok then
			span:set("ok", true)
			if type(response.value) == "table" then
				span:set("id", response.value.id)
			end
		else
			local err = response and response.err or {}
			span:set("ok", false)
			span:set("kind", err.kind)
		end

		return response
	end)
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
