-- runtime/openresty/pods_live.lua
-- /__dev/pods/live?slot=<id>&selector=<label-selector>[&errors_only=1]
-- SSE stream of Kubernetes pod logs. Each (slot, selector) pair resolves to the
-- first Running pod matching the label selector and tails its log through the
-- Kubernetes API using the pod's own ServiceAccount. A pod that goes away is
-- re-resolved on the next poll.

local sse = require("runtime.openresty.sse")
local cjson = require("cjson")

local SA_DIR = os.getenv("FUWA_K8S_SA_DIR") or "/var/run/secrets/kubernetes.io/serviceaccount"
local API_HOST = os.getenv("FUWA_K8S_API_HOST") or "kubernetes.default.svc"
local API_PORT = tonumber(os.getenv("FUWA_K8S_API_PORT") or "") or 443
local TAIL_LINES = tonumber(os.getenv("FUWA_POD_LOG_TAIL") or "") or 200
local POLL_SECONDS = 0.5
local STREAM_SECONDS = 3600

local ERROR_PATTERN = "[Ee]rror|[Ww]arn|[Ff]ail|[Ff]atal|[Pp]anic|[Ee]xception|[Tt]raceback"

local function read_file(path)
	local file = io.open(path, "rb")
	if not file then
		return nil
	end
	local contents = file:read("*a")
	file:close()
	return contents and contents:gsub("%s+$", "")
end

local function url_encode(value)
	return (tostring(value or ""):gsub("([^%w%-%._~])", function(char)
		return string.format("%%%02X", char:byte())
	end))
end

local function as_list(value)
	if type(value) == "table" then
		return value
	end
	if type(value) == "string" then
		return { value }
	end
	return {}
end

-- api_get performs one GET against the Kubernetes API. The request uses
-- HTTP/1.0 so the response body is delivered un-chunked and can be read to EOF.
local function api_get(path, token)
	local sock = ngx.socket.tcp()
	sock:settimeout(3000)

	local ok, err = sock:connect(API_HOST, API_PORT)
	if not ok then
		return nil, "connect failed: " .. tostring(err)
	end

	if API_PORT == 443 then
		local ssl_ok, ssl_err = sock:sslhandshake(false, API_HOST, true)
		if not ssl_ok then
			sock:close()
			return nil, "tls failed: " .. tostring(ssl_err)
		end
	end

	local request = table.concat({
		"GET " .. path .. " HTTP/1.0\r\n",
		"Host: " .. API_HOST .. "\r\n",
		"Authorization: Bearer " .. tostring(token) .. "\r\n",
		"Accept: application/json, text/plain\r\n",
		"Connection: close\r\n\r\n",
	})

	local bytes, send_err = sock:send(request)
	if not bytes then
		sock:close()
		return nil, "send failed: " .. tostring(send_err)
	end

	local status_line, line_err = sock:receive("*l")
	if not status_line then
		sock:close()
		return nil, "no status line: " .. tostring(line_err)
	end
	local code = tonumber(status_line:match("^HTTP/%d%.%d (%d+)"))

	while true do
		local line = sock:receive("*l")
		if not line or line == "" then
			break
		end
	end

	local body = sock:receive("*a") or ""
	sock:close()
	return code, body
end

-- resolve_pod lists pods matching the selector and returns the first Running
-- one, falling back to the first pod of any phase when none is Running yet.
local function resolve_pod(namespace, selector, token)
	local path = "/api/v1/namespaces/" .. namespace .. "/pods?limit=200"
	if selector ~= "" then
		path = path .. "&labelSelector=" .. url_encode(selector)
	end

	local code, body = api_get(path, token)
	if code ~= 200 then
		return nil, "api " .. tostring(code) .. ": " .. tostring(body):sub(1, 160)
	end

	local ok, decoded = pcall(cjson.decode, body)
	if not ok then
		return nil, "invalid pod list response"
	end

	local first
	for _, item in ipairs(decoded.items or {}) do
		local name = item.metadata and item.metadata.name
		local phase = item.status and item.status.phase
		if name and phase == "Running" then
			return name
		end
		if name and not first then
			first = name
		end
	end

	return first
end

local function fetch_logs(namespace, pod, token)
	local path = "/api/v1/namespaces/" .. namespace .. "/pods/" .. url_encode(pod)
		.. "/log?tailLines=" .. TAIL_LINES .. "&timestamps=false"
	local code, body = api_get(path, token)
	if code ~= 200 then
		return nil, "api " .. tostring(code) .. ": " .. tostring(body):sub(1, 160)
	end
	return body
end

local function split_lines(body)
	local lines = {}
	for line in (body .. "\n"):gmatch("(.-)\n") do
		lines[#lines + 1] = line
	end
	return lines
end

-- ── request parsing ────────────────────────────────────────────────
local args = ngx.req.get_uri_args()
local errors_only = args.errors_only ~= nil and args.errors_only ~= "0"

local requested_ids = as_list(args.slot)
local requested_selectors = as_list(args.selector)

local slots = {}
for index, slot_id in ipairs(requested_ids) do
	local id = tostring(slot_id):gsub("%s+", "")
	if id:match("^[A-Za-z0-9_%-]+$") then
		slots[#slots + 1] = { id = id, selector = tostring(requested_selectors[index] or "") }
	end
end

sse.start_stream()

if #slots == 0 then
	sse.send_event("error", cjson.encode({ message = "no valid slots provided" }))
	return
end

local token = read_file(SA_DIR .. "/token")
if not token then
	sse.send_event("error", cjson.encode({ message = "service account token not found" }))
	return
end

local namespace = read_file(SA_DIR .. "/namespace") or "default"

local slot_ids = {}
for _, slot in ipairs(slots) do
	slot_ids[#slot_ids + 1] = slot.id
end
sse.send_event("ready", cjson.encode({ namespace = namespace, slots = slot_ids }))

local state = {}
for _, slot in ipairs(slots) do
	state[slot.id] = { pod = nil, offset = 0 }
end

local started = ngx.now()
while ngx.now() - started < STREAM_SECONDS do
	for _, slot in ipairs(slots) do
		local slot_state = state[slot.id]

		if slot_state.pod == nil then
			local pod, resolve_err = resolve_pod(namespace, slot.selector, token)
			if pod then
				slot_state.pod = pod
				slot_state.offset = 0
				sse.send_event("status", cjson.encode({ slot = slot.id, pod = pod, status = "connected" }))
			else
				sse.send_event("status", cjson.encode({ slot = slot.id, status = "connecting", message = resolve_err }))
			end
		end

		if slot_state.pod then
			local body, log_err = fetch_logs(namespace, slot_state.pod, token)
			if body then
				local lines = split_lines(body)
				-- The tail window slides; reset when it drops below our offset.
				if #lines < slot_state.offset then
					slot_state.offset = 0
				end
				for i = slot_state.offset + 1, #lines do
					local line = lines[i]
					if not errors_only or line:match(ERROR_PATTERN) then
						sse.send_event("log", cjson.encode({ slot = slot.id, pod = slot_state.pod, line = line }))
					end
				end
				slot_state.offset = #lines
			else
				sse.send_event("status", cjson.encode({ slot = slot.id, pod = slot_state.pod, status = "closed", message = log_err }))
				slot_state.pod = nil
				slot_state.offset = 0
			end
		end
	end

	ngx.sleep(POLL_SECONDS)
end
