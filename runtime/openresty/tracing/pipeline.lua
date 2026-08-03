local cjson = require("cjson")
local router = require("runtime.openresty.tracing.router")

local M = {}

local MAX_BUFFER = 200

local function append_to_ring_buffer(shm, event)
	event._ts = event._ts or ngx.now()
	local buffer_json = shm:get("buffer")
	local buffer = cjson.decode(buffer_json or "[]") or {}
	table.insert(buffer, cjson.encode(event))
	while #buffer > MAX_BUFFER do
		table.remove(buffer, 1)
	end
	shm:set("buffer", cjson.encode(buffer))
	shm:incr("trace_counter", 1, 0)
end

function M.record_event(event)
	if type(event) ~= "table" then
		return false, "event must be a table"
	end

	local shm = ngx.shared.traces
	if not shm then
		return false, "no shared dict"
	end

	append_to_ring_buffer(shm, event)
	router.route_event(event)
	return true
end

return M
