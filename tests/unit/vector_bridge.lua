package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local bridge = require("runtime.host.vector_bridge")

local results = {
	passed = 0,
	failed = 0,
	failures = {}
}

local t = {}

function t.test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		results.passed = results.passed + 1
		return
	end

	results.failed = results.failed + 1
	results.failures[#results.failures + 1] = string.format("%s\n  %s", name, tostring(err))
end

function t.eq(actual, expected, label)
	if actual ~= expected then
		error(string.format("%s expected %s, got %s", label or "equality check", tostring(expected), tostring(actual)), 2)
	end
end

function t.truthy(value, label)
	if not value then
		error(label or "expected truthy value", 2)
	end
end

function t.falsy(value, label)
	if value then
		error(label or "expected falsy value", 2)
	end
end

t.test("build_payload keeps the existing request fields flat", function()
	local payload = bridge.build_payload({
		kind = "request",
		trace_id = "trace_abc123",
		method = "GET",
		path = "/buy/onigiri",
		status = 200,
		duration_ms = 47,
	}, {
		now = function()
			return "2026-07-23T14:32:01Z"
		end,
		service = "fuwa-dev",
	})

	t.eq(payload.timestamp, "2026-07-23T14:32:01Z", "expected injected timestamp")
	t.eq(payload.service, "fuwa-dev", "expected service name")
	t.eq(payload.kind, "request", "expected kind")
	t.eq(payload.trace_id, "trace_abc123", "expected trace id")
	t.eq(payload.method, "GET", "expected method")
	t.eq(payload.route, "/buy/onigiri", "expected route")
	t.eq(payload.status, 200, "expected status")
	t.eq(payload.duration_ms, 47, "expected duration")
	t.eq(payload.request_total, 1, "expected request counter")
	t.eq(payload.error_total, 0, "expected error counter")
	t.eq(payload.error, bridge.json_null, "expected null error")
end)

t.test("build_payload promotes failed requests to 500 when status is missing", function()
	local payload = bridge.build_payload({
		kind = "request",
		trace_id = "trace_failed",
		method = "POST",
		path = "/counter",
		duration_ms = 12.25,
		failed = true,
		error = {
			message = "boom",
		},
	}, {
		now = function()
			return "2026-07-23T14:32:02Z"
		end,
	})

	t.eq(payload.status, 500, "expected fallback status")
	t.eq(payload.error_total, 1, "expected error counter")
	t.truthy(payload.error ~= bridge.json_null, "expected serialized error")
end)

t.test("encode_payload produces JSON with null support", function()
	local body = bridge.encode_payload({
		service = "fuwa",
		error = bridge.json_null,
		duration_ms = 47,
		ok = true,
	})

	t.truthy(body:find('"service":"fuwa"', 1, true) ~= nil, "expected service field")
	t.truthy(body:find('"error":null', 1, true) ~= nil, "expected null field")
	t.truthy(body:find('"duration_ms":47', 1, true) ~= nil, "expected numeric field")
	t.truthy(body:find('"ok":true', 1, true) ~= nil, "expected boolean field")
end)

t.test("forward_event builds the background curl command only when enabled", function()
	local command
	local ok, err = bridge.forward_event({
		kind = "request",
		trace_id = "trace_send",
		method = "GET",
		path = "/",
		status = 200,
		duration_ms = 5,
	}, {
		url = "http://vector-router:8687/",
		now = function()
			return "2026-07-23T14:32:03Z"
		end,
		run = function(cmd)
			command = cmd
			return true
		end,
	})

	t.truthy(ok, "expected background send")
	t.eq(err, nil, "expected no error")
	t.truthy(command:find("curl", 1, true) ~= nil, "expected curl command")
	t.truthy(command:find("http://vector-router:8687/", 1, true) ~= nil, "expected vector URL")
	t.truthy(command:find('"route":"%2F"', 1, true) == nil, "expected raw JSON body, not form encoding")
	t.truthy(command:find('"route":"/"', 1, true) ~= nil, "expected route in JSON body")
	t.truthy(command:find(">/dev/null 2>&1 &", 1, true) ~= nil, "expected background shell")
end)

t.test("forward_event leaves non-request events alone", function()
	local ok, err = bridge.forward_event({
		kind = "span_end",
		name = "compile",
	}, {
		url = "http://vector-router:8687/",
		run = function()
			error("should not run")
		end,
	})

	t.falsy(ok, "expected ignored event")
	t.eq(err, "ignored", "expected ignored marker")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("vector bridge unit tests passed (%d tests)", results.passed))
