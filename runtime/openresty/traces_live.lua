-- runtime/openresty/traces_live.lua
-- /__dev/traces/live — SSE stream of real-time trace events.
-- Uses a monotonically-increasing trace_counter in the shared dict to
-- detect new entries, avoiding position-based tracking that breaks on
-- ring-buffer wrap.

local sse = require("runtime.openresty.sse")
local cjson = require("cjson")

sse.start_stream()
sse.send_event("ready", cjson.encode({ok = true}))

local shm = ngx.shared.traces
if not shm then
	sse.send_event("error", cjson.encode({message = "no trace buffer"}))
	return
end

-- trace_counter is a strictly-increasing count of total trace events ingested.
-- Each SSE subscriber remembers how many it has already seen.
local seen = tonumber(shm:get("trace_counter") or "0") or 0
local started = ngx.now()

while ngx.now() - started < 3600 do  -- 1 hour max
	ngx.sleep(0.1)

	local total = tonumber(shm:get("trace_counter") or "0") or 0
	if total > seen then
		local buffer_json = shm:get("buffer")
		local buffer = cjson.decode(buffer_json or "[]") or {}

		-- How many new entries to send: total - seen.
		-- Read from the end of the buffer backwards, since buffer is a ring.
		local new_count = total - seen
		local buf_len = #buffer
		local start_idx = math.max(1, buf_len - new_count + 1)

		for i = start_idx, buf_len do
			local entry = buffer[i]
			if entry then
				local ok = sse.send_event("trace", entry)
				if not ok then
					return -- client disconnected
				end
			end
		end

		seen = total
	end
end
