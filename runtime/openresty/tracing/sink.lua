local cjson = require("cjson")
local trace = require("runtime.trace")
local pipeline = require("runtime.openresty.tracing.pipeline")

local M = {}

local installed = false

local function openresty_trace_sink(event)
	if type(event) ~= "table" then
		return
	end
	local shm = ngx.shared.traces
	if not shm then
		return
	end
	local ok = pcall(cjson.encode, event)
	if not ok then
		return
	end
	pipeline.record_event(event)
end

function M.install()
	if installed then
		return
	end
	trace.set_scopes("all")
	trace.set_sink(openresty_trace_sink)
	installed = true
end

return M
