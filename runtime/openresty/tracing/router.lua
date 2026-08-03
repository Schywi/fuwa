local otlp_adapter = require("runtime.openresty.tracing.adapters.otlp")
local vector_adapter = require("runtime.openresty.tracing.adapters.vector")

local M = {}

local base_url = (os.getenv("FUWA_SIGNOZ_OTLP_URL") or ""):gsub("/v1/traces$", "")

local adapters = {
	metrics = vector_adapter.new(os.getenv("FUWA_VECTOR_URL") or ""),
	traces  = otlp_adapter.new(base_url .. "/v1/traces", "fuwa", "otlp traces"),
	logs    = otlp_adapter.new(base_url .. "/v1/logs",   "fuwa", "otlp logs"),
}

function M.emit_trace(event)
	adapters.traces:emit_trace(event)
end

function M.emit_metric(event)
	adapters.metrics:emit_metric(event)
end

function M.emit_log(event)
	adapters.logs:emit_log(event)
end

function M.route_event(event)
	if type(event) ~= "table" then
		return
	end

	if event.kind == "request" then
		M.emit_trace(event)
		M.emit_metric(event)
		return
	end

	if event.kind == "span_log" then
		M.emit_log(event)
	end
end

return M
