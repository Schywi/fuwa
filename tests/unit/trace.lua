package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local trace = require("runtime.trace")

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

local function capture_events(spec, fn)
	local events = {}
	trace.configure({
		sink = function(event)
			events[#events + 1] = event
		end,
		trace = spec,
	})

	local ok, err = pcall(fn, events)
	trace.reset()
	assert(ok, err)
	return events
end

t.test("spans nest and inherit trace ids", function()
	local events = capture_events("db", function()
		trace.span("request", {
			method = "GET",
			path = "/home"
		}, function(request_span)
			trace.span("db.sqlite_local", {
				op = "find",
				path = ".fuwa-dev/sqlite-local.db"
			}, function(db_span)
				db_span:log("helper dispatch", {
					path = ".fuwa-dev/sqlite-local.db"
				})
				request_span:set("status", 200)
				return "ok"
			end)
		end)
	end)

	t.eq(events[1].kind, "span_start", "expected request start event")
	t.eq(events[2].kind, "span_start", "expected child start event")
	t.eq(events[3].kind, "span_log", "expected child log event")
	t.eq(events[4].kind, "span_end", "expected child end event")
	t.eq(events[5].kind, "request", "expected request close event")
	t.eq(events[1].trace_id, events[2].trace_id, "expected inherited trace id")
	t.eq(events[2].parent_id, events[1].span_id, "expected parent span id")
	t.eq(events[2].depth, 1, "expected child depth")
	t.eq(events[5].status, 200, "expected canonical status")
	t.truthy(events[5].trace_id ~= nil, "expected request trace id")
end)

t.test("manual spans can be started and closed explicitly", function()
	local events = capture_events("db", function()
		local span = trace.start("db.memory", {
			collection = "wallets",
			op = "create"
		})
		span:log("saved", {
			rows = 1
		})
		span:close({
			ok = true,
			rows = 1
		})
	end)

	t.eq(events[1].kind, "span_start", "expected manual span start")
	t.eq(events[2].kind, "span_log", "expected manual span log")
	t.eq(events[3].kind, "span_end", "expected manual span end")
	t.eq(events[3].attrs.ok, true, "expected close attrs")
	t.eq(events[3].attrs.rows, 1, "expected close attrs")
end)

t.test("disabled scopes produce a no-op path", function()
	local events = capture_events("", function()
		local result = trace.span("compile", {
			files = 1
		}, function(span)
			span:log("ignored")
			return "ok"
		end)
		t.eq(result, "ok", "expected return value")
	end)

	t.eq(#events, 0, "expected no emitted events")
end)

t.test("scope filtering uses prefix matching", function()
	local events = capture_events("db,compile", function()
		trace.span("render", {
			path = "/home"
		}, function()
			return true
		end)

		trace.span("db.sqlite_local", {
			path = "/tmp/fuwa.db"
		}, function()
			return true
		end)
	end)

	t.eq(#events, 2, "expected only db span events")
	t.eq(events[1].kind, "span_start", "expected db start")
	t.eq(events[1].name, "db.sqlite_local", "expected db child name")
	t.eq(events[2].kind, "span_end", "expected db end")
end)

t.test("failed spans record and re-raise the original error", function()
	local events = {}
	trace.configure({
		sink = function(event)
			events[#events + 1] = event
		end,
		trace = "compile",
	})

	local ok, err = pcall(function()
		trace.span("compile", {
			files = 1
		}, function(span)
			span:log("before crash")
			error("boom", 0)
		end)
	end)

	trace.reset()

	t.falsy(ok, "expected the error to re-raise")
	t.eq(err, "boom", "expected original error")
	t.eq(events[#events].kind, "span_end", "expected closing event")
	t.truthy(events[#events].failed, "expected failed span")
	t.eq(events[#events].error, "boom", "expected recorded error")
end)

t.test("request spans emit the canonical line fields", function()
	local events = capture_events("", function()
		trace.span("request", {
			method = "GET",
			path = "/home"
		}, function(span)
			span:set("status", 200)
			return "ok"
		end)
	end)

	t.eq(events[#events].kind, "request", "expected request event")
	t.eq(events[#events].method, "GET", "expected method")
	t.eq(events[#events].path, "/home", "expected path")
	t.eq(events[#events].status, 200, "expected status")
	t.truthy(events[#events].trace_id ~= nil, "expected trace id")
	t.truthy(events[#events].duration_ms ~= nil, "expected duration")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("trace unit tests passed (%d tests)", results.passed))
