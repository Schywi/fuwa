local cjson = require("cjson")
local http = require("runtime.openresty.tracing.http")

local M = {}
M.__index = M

function M.new(url)
	return setmetatable({
		target = http.parse_target(url),
	}, M)
end

local function request_metric_payload(event)
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

function M:emit_metric(event)
	if not self.target then
		return false, "vector target not configured"
	end

	local payload = request_metric_payload(event)
	if not payload then
		return false, "event does not produce vector metrics"
	end

	local ok, payload_json = pcall(cjson.encode, payload)
	if not ok then
		return false, "failed to encode vector payload"
	end

	return http.schedule_json(self.target, payload_json, "vector sink")
end

function M:emit_log(_event)
	return false, "vector log sink not implemented"
end

return M
