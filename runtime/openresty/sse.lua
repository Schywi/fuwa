-- runtime/openresty/sse.lua
-- Reusable Server-Sent Events helpers for OpenResty.

local _M = {}

function _M.start_stream()
	ngx.header.content_type = "text/event-stream"
	ngx.header.cache_control = "no-cache"
	ngx.header.x_accel_buffering = "no"
	ngx.header.connection = "keep-alive"
	ngx.send_headers()
end

function _M.send_event(event_name, data)
	local message = string.format("event: %s\ndata: %s\n\n", event_name, tostring(data))
	local ok, err = ngx.print(message)
	ngx.flush(true)
	return ok, err
end

function _M.send_keepalive()
	ngx.print(": keepalive\n\n")
	ngx.flush(true)
end

return _M
