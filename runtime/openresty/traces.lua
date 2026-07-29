-- runtime/openresty/traces.lua
-- /__dev/traces — GET returns the ring buffer, POST ingests trace events.

local cjson = require("cjson")
local method = ngx.req.get_method()

if method == "GET" then
	local shm = ngx.shared.traces
	local buffer_json = shm and shm:get("buffer")
	local buffer = cjson.decode(buffer_json or "[]") or {}

	local traces = {}
	for _, entry in ipairs(buffer) do
		local ok, parsed = pcall(cjson.decode, entry)
		if ok then
			table.insert(traces, parsed)
		end
	end

	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({traces = traces}))
	return
end

if method == "POST" then
	ngx.req.read_body()
	local body_data = ngx.req.get_body_data()
	if not body_data then
		ngx.status = 400
		ngx.header.content_type = "application/json"
		ngx.say(cjson.encode({ok = false, error = "empty body"}))
		return
	end

	local ok, payload = pcall(cjson.decode, body_data)
	if not ok then
		ngx.status = 400
		ngx.header.content_type = "application/json"
		ngx.say(cjson.encode({ok = false, error = "invalid json"}))
		return
	end

	local events = payload.events or {}
	local shm = ngx.shared.traces
	if not shm then
		ngx.header.content_type = "application/json"
		ngx.say(cjson.encode({ok = false, error = "no shared dict"}))
		return
	end

	local buffer_json = shm:get("buffer")
	local buffer = cjson.decode(buffer_json or "[]") or {}
	local count = 0

	for _, event in ipairs(events) do
		event._ts = ngx.now()
		table.insert(buffer, cjson.encode(event))
		count = count + 1
	end

	while #buffer > 200 do
		table.remove(buffer, 1)
	end
	shm:set("buffer", cjson.encode(buffer))
	shm:incr("trace_counter", 1, 0)

	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({ok = true, ingested = count}))
	return
end

ngx.status = 405
ngx.header.content_type = "application/json"
ngx.say(cjson.encode({ok = false, error = "method not allowed"}))
