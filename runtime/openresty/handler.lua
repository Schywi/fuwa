-- runtime/openresty/handler.lua
-- Main request handler — routes all non-/__dev/ requests through fuwa-dev.lua.
-- /__dev/reload SSE and /__dev/traces SSE are handled by separate location blocks.

local fuwa_dev = require("runtime.fuwa-dev")

-- Re-set package path for OpenResty context (fuwa-dev.lua does this too,
-- but only when loaded as a script — we need it in the module context too)
local root_dir = fuwa_dev.ROOT_DIR
if root_dir then
	package.path = root_dir .. "/?.lua;" .. root_dir .. "/?/init.lua;" .. root_dir .. "/?/?.lua;" .. package.path
end

-- Set trace sink for OpenResty — writes to shared dict instead of stderr.
-- Must be set after fuwa-dev.lua loads (it sets its own sink for CGI mode,
-- guarded by `if not ngx`).
local trace = require("runtime.trace")
local cjson = require("cjson")
local function openresty_trace_sink(event)
	if type(event) ~= "table" then return end
	local shm = ngx.shared.traces
	if not shm then return end
	local ok, json = pcall(cjson.encode, event)
	if not ok then return end
	local buffer_json = shm:get("buffer")
	local buffer = cjson.decode(buffer_json or "[]") or {}
	event._ts = ngx.now()
	json = cjson.encode(event)
	table.insert(buffer, json)
	while #buffer > 200 do table.remove(buffer, 1) end
	shm:set("buffer", cjson.encode(buffer))
	shm:incr("trace_counter", 1, 0)
end
trace.set_sink(openresty_trace_sink)

-- SSE reload handler (long-poll with non-blocking sleeps)
local function handle_reload_sse()
	local sse = require("runtime.openresty.sse")
	sse.start_stream()
	ngx.print(": connected\n\n")
	ngx.flush(true)

	local token_path = root_dir .. "/.fuwa-dev/reload-token"

	local function get_mtime()
		local f = io.open(token_path, "rb")
		if not f then return "" end
		-- Use the file's content as signature (we write os.time() to it)
		local sig = f:read("*a") or ""
		f:close()
		return sig:gsub("%s+$", "")
	end

	local last_sig = get_mtime()
	local started = ngx.now()

	while ngx.now() - started < 30 do
		ngx.sleep(0.25)
		local current_sig = get_mtime()
		if current_sig ~= last_sig then
			ngx.print("data: reload\n\n")
			ngx.flush(true)
			return
		end
	end
end

local method = ngx.req.get_method()
local uri = ngx.var.uri

-- /__dev/reload SSE — handled here (streaming)
if uri == "/__dev/reload" then
	handle_reload_sse()
	return
end

-- Build full path with query string
local query = ngx.var.query_string or ""
local path = uri
if query ~= "" then path = path .. "?" .. query end

-- Read body
ngx.req.read_body()
local body = ngx.req.get_body_data()

-- Route through fuwa-dev.lua
local response = fuwa_dev.route_request(method, path, body)
if not response then
	ngx.status = 404
	ngx.say("Not found")
	return
end

-- Write response via OpenResty APIs
ngx.status = response.status
if response.headers then
	for k, v in pairs(response.headers) do
		if k ~= "Connection" then  -- nginx manages Connection header
			ngx.header[k] = v
		end
	end
end
if response.body then
	ngx.print(response.body)
end
