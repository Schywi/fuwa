local otlp_adapter = require("runtime.openresty.tracing.adapters.otlp")
local vector_adapter = require("runtime.openresty.tracing.adapters.vector")

local M = {}

local adapters = {
	vector = vector_adapter.new(os.getenv("FUWA_VECTOR_URL") or ""),
	signoz = otlp_adapter.new(os.getenv("FUWA_SIGNOZ_OTLP_URL") or "", "fuwa", "signoz sink"),
	uptrace = otlp_adapter.new(os.getenv("FUWA_UPTRACE_OTLP_URL") or "", "fuwa", "uptrace sink"),
}

function M.emit_trace(event)
	adapters.signoz:emit_trace(event)
	adapters.uptrace:emit_trace(event)
end

function M.emit_metric(event)
	adapters.vector:emit_metric(event)
end

function M.emit_log(event)
	adapters.vector:emit_log(event)
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
