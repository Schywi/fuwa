-- runtime/openresty/trace_sink.lua
-- Shared OpenResty trace sink installer for routes that bypass handler.lua.

local cjson = require("cjson")
local trace = require("runtime.trace")

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
	local buffer_json = shm:get("buffer")
	local buffer = cjson.decode(buffer_json or "[]") or {}
	event._ts = ngx.now()
	table.insert(buffer, cjson.encode(event))
	while #buffer > 200 do
		table.remove(buffer, 1)
	end
	shm:set("buffer", cjson.encode(buffer))
	shm:incr("trace_counter", 1, 0)
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
