local cjson = require("cjson")
local http = require("runtime.openresty.tracing.http")

local M = {}
M.__index = M

function M.new(url, service_name, label)
	return setmetatable({
		target = http.parse_target(url),
		service_name = service_name or "fuwa",
		label = label or "otlp sink",
	}, M)
end

local function request_span_payload(event, service_name)
	if type(event) ~= "table" or event.kind ~= "request" then
		return nil
	end

	local status = tonumber(event.status) or (event.failed and 500 or 200)
	local method = event.method or "GET"
	local path = event.path or "/"
	local started_at = event._ts or ngx.now()
	local start_time_unix_nano = math.floor(started_at * 1000000000)
	local duration_nano = math.floor((tonumber(event.duration_ms) or 0) * 1000000)

	return {
		resourceSpans = {{
			resource = {
				attributes = {
					{ key = "service.name", value = { stringValue = service_name } },
				},
			},
			scopeSpans = {{
				spans = {{
					name = method .. " " .. path,
					kind = 2,
					startTimeUnixNano = tostring(start_time_unix_nano),
					endTimeUnixNano = tostring(start_time_unix_nano + duration_nano),
					status = { code = status >= 400 and 2 or 1 },
					attributes = {
						{ key = "http.method", value = { stringValue = method } },
						{ key = "http.route", value = { stringValue = path } },
						{ key = "http.status_code", value = { intValue = tostring(status) } },
					},
				}},
			}},
		}},
	}
end

local function padded_id(value, width, fallback)
	local compact = tostring(value or ""):gsub("[^a-fA-F0-9]", "")
	if compact == "" then
		compact = fallback
	end
	if #compact < width then
		compact = compact .. string.rep("0", width - #compact)
	end
	return compact:sub(1, width)
end

local function request_log_payload(event, service_name)
	if type(event) ~= "table" or event.kind ~= "span_log" then
		return nil
	end

	local now_ns = math.floor(ngx.now() * 1000000000)
	local attrs = {}
	for k, v in pairs(event.fields or {}) do
		table.insert(attrs, { key = tostring(k), value = { stringValue = tostring(v) } })
	end

	return {
		resourceLogs = {{
			resource = {
				attributes = {
					{ key = "service.name", value = { stringValue = service_name } },
				},
			},
			scopeLogs = {{
				logRecords = {{
					timeUnixNano = tostring(now_ns),
					observedTimeUnixNano = tostring(now_ns),
					severityNumber = 9,
					severityText = "INFO",
					body = { stringValue = tostring(event.message or "event") },
					attributes = attrs,
					traceId = padded_id(event.trace_id, 32, "1"),
					spanId = padded_id(event.span_id, 16, "1"),
				}},
			}},
		}},
	}
end

function M:emit_trace(event)
	if not self.target then
		return false, "otlp target not configured"
	end

	local payload = request_span_payload(event, self.service_name)
	if not payload then
		return false, "event does not produce an otlp trace"
	end

	local span = payload.resourceSpans[1].scopeSpans[1].spans[1]
	span.traceId = padded_id(event.trace_id, 32, "1")
	span.spanId = padded_id(event.span_id, 16, "1")

	local ok, payload_json = pcall(cjson.encode, payload)
	if not ok then
		return false, "failed to encode otlp payload"
	end

	return http.schedule_json(self.target, payload_json, self.label)
end

function M:emit_log(event)
	if not self.target then
		return false, "otlp target not configured"
	end

	local payload = request_log_payload(event, self.service_name)
	if not payload then
		return false, "event does not produce an otlp log"
	end

	local ok, payload_json = pcall(cjson.encode, payload)
	if not ok then
		return false, "failed to encode otlp log payload"
	end

	return http.schedule_json(self.target, payload_json, self.label)
end

return M
