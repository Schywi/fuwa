local otlp_adapter = require("runtime.openresty.tracing.adapters.otlp")

local M = {}

-- OTLP endpoint for traces, logs, and metrics. nginx's resolver does not apply
-- Kubernetes search domains, so the service must be addressed by FQDN.
local otlp_base = os.getenv("FUWA_OTLP_URL") or "http://otel-collector.fuwa.svc.cluster.local:4318"

local adapters = {
	metrics = otlp_adapter.new(otlp_base .. "/v1/metrics", "fuwa", "otlp metrics"),
	traces  = otlp_adapter.new(otlp_base .. "/v1/traces", "fuwa", "otlp traces"),
	logs    = otlp_adapter.new(otlp_base .. "/v1/logs",   "fuwa", "otlp logs"),
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
