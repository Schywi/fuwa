local cjson = require("cjson")

local M = {}

local MAX_BUFFER = 200

local function parse_target(url)
	if type(url) ~= "string" or url == "" then
		return nil
	end
	local host, port, path = url:match("^http://([^:/]+):?(%d*)(/.*)$")
	if not host then
		host, port = url:match("^http://([^:/]+):?(%d*)/?$")
		path = "/"
	end
	if not host then
		return nil
	end
	return {
		host = host,
		port = tonumber(port) or 80,
		path = path ~= "" and path or "/",
	}
end

local vector_target = parse_target(os.getenv("FUWA_VECTOR_URL") or "")

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

local function vector_payload_for(event)
	if type(event) ~= "table" or event.kind ~= "request" then
		return nil
	end

	local status = tonumber(event.status) or (event.failed and 500 or 200)
	return {
		method = event.method or "GET",
		route = event.path or "/",
		status = status,
		duration_ms = tonumber(event.duration_ms) or 0,
		request_total = 1,
		error_total = status >= 400 and 1 or 0,
		trace_id = event.trace_id,
		timestamp = math.floor((event._ts or ngx.now()) * 1000000000),
		service = "fuwa",
	}
end

local function post_payload(premature, target, payload_json)
	if premature or not target or not payload_json then
		return
	end

	local sock = ngx.socket.tcp()
	sock:settimeout(1000)

	local ok, err = sock:connect(target.host, target.port)
	if not ok then
		ngx.log(ngx.WARN, "trace forward connect failed: ", tostring(err))
		return
	end

	local request_data = table.concat({
		"POST " .. target.path .. " HTTP/1.1\r\n",
		"Host: " .. target.host .. "\r\n",
		"Content-Type: application/json\r\n",
		"Connection: close\r\n",
		"Content-Length: " .. tostring(#payload_json) .. "\r\n\r\n",
		payload_json,
	})

	local bytes, send_err = sock:send(request_data)
	if not bytes then
		ngx.log(ngx.WARN, "trace forward send failed: ", tostring(send_err))
	end

	sock:close()
end

local function enqueue_forward(event)
	if not vector_target then
		return
	end

	local payload = vector_payload_for(event)
	if not payload then
		return
	end

	local ok, payload_json = pcall(cjson.encode, payload)
	if not ok then
		return
	end

	local scheduled, err = ngx.timer.at(0, post_payload, vector_target, payload_json)
	if not scheduled then
		ngx.log(ngx.WARN, "trace forward timer failed: ", tostring(err))
	end
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
	enqueue_forward(event)
	return true
end

return M
