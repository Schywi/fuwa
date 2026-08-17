local log = require("runtime.log")

local M = {}

local default_sink = log.pretty_sink
local sink = default_sink
local stack = {}
local enabled_scopes = {}
local trace_all = false
local next_id = 0

local noop_span = {
	__noop = true,
}

function noop_span:log()
	return self
end

function noop_span:set()
	return self
end

function noop_span:close()
	return nil
end

local function now_ms()
	return os.clock() * 1000
end

local function deep_copy(value)
	if type(value) ~= "table" then
		return value
	end

	local out = {}
	for key, entry in pairs(value) do
		out[deep_copy(key)] = deep_copy(entry)
	end
	return out
end

local function merge_attrs(base, extra)
	local out = deep_copy(base or {})
	for key, value in pairs(extra or {}) do
		out[key] = deep_copy(value)
	end
	return out
end

local function new_id(prefix)
	next_id = next_id + 1
	return string.format("%s_%x_%x", prefix or "id", os.time(), next_id)
end

local function scope_enabled(name)
	if name == "request" or trace_all then
		return true
	end

	for scope in pairs(enabled_scopes) do
		if name == scope or name:sub(1, #scope + 1) == scope .. "." then
			return true
		end
	end

	return false
end

local function current_span()
	return stack[#stack]
end

local function remove_span(span)
	for index = #stack, 1, -1 do
		if stack[index] == span then
			table.remove(stack, index)
			return
		end
	end
end

local function emit(event)
	if sink then
		sink(event)
	end
end

local function set_scope_spec(spec)
	enabled_scopes = {}
	trace_all = false

	if spec == nil then
		return
	end

	if type(spec) == "table" then
		for _, value in ipairs(spec) do
			enabled_scopes[tostring(value)] = true
		end
		return
	end

	local text = tostring(spec)
	if text == "" then
		return
	end

	if text == "1" or text == "all" then
		trace_all = true
		return
	end

	for token in text:gmatch("[^,%s]+") do
		enabled_scopes[token] = true
	end
end

local function load_env_spec()
	local trace_spec = os.getenv("FUWA_TRACE")
	if trace_spec ~= nil and trace_spec ~= "" then
		return trace_spec
	end

	local db_spec = os.getenv("FUWA_DB_TRACE")
	if db_spec == "1" or db_spec == "all" then
		return "db"
	end
	if db_spec ~= nil and db_spec ~= "" then
		return db_spec
	end

	return nil
end

local function create_span(name, attrs)
	local parent = current_span()
	local span = {
		attrs = deep_copy(attrs or {}),
		closed = false,
		depth = parent and parent.depth + 1 or 0,
		failed = false,
		name = name,
		parent_id = parent and parent.span_id or nil,
		request = name == "request",
		started_at = now_ms(),
		span_id = new_id("span"),
		trace_id = parent and parent.trace_id or new_id("trace"),
	}

	function span:log(message, fields)
		if self.closed then
			return self
		end

		emit({
			kind = "span_log",
			name = self.name,
			trace_id = self.trace_id,
			span_id = self.span_id,
			parent_id = self.parent_id,
			depth = self.depth,
			message = tostring(message or "event"),
			fields = deep_copy(fields or {}),
		})
		return self
	end

	function span:set(key, value)
		if not self.closed then
			self.attrs[key] = deep_copy(value)
		end
		return self
	end

	function span:close(extra_attrs)
		if self.closed then
			return self.summary or merge_attrs(self.attrs, extra_attrs)
		end

		self.closed = true
		self.summary = merge_attrs(self.attrs, extra_attrs)
		remove_span(self)

		local duration_ms = now_ms() - self.started_at
		local event = {
			kind = self.request and "request" or "span_end",
			name = self.name,
			trace_id = self.trace_id,
			span_id = self.span_id,
			parent_id = self.parent_id,
			depth = self.depth,
			attrs = self.summary,
			duration_ms = duration_ms,
			failed = self.failed,
			error = self.error,
		}

		if self.request then
			event.method = self.summary.method
			event.path = self.summary.path
			event.status = self.summary.status
		end

		emit(event)
		return self.summary
	end

	emit({
		kind = "span_start",
		name = span.name,
		trace_id = span.trace_id,
		span_id = span.span_id,
		parent_id = span.parent_id,
		depth = span.depth,
		attrs = deep_copy(span.attrs),
	})

	stack[#stack + 1] = span
	return span
end

function M.emit(event)
	emit(event)
end

function M.set_sink(fn)
	sink = fn or default_sink
end

function M.set_scopes(spec)
	set_scope_spec(spec)
end

function M.configure(opts)
	opts = opts or {}
	if opts.sink ~= nil then
		sink = opts.sink or default_sink
	end
	if opts.trace ~= nil then
		set_scope_spec(opts.trace)
	elseif opts.scopes ~= nil then
		set_scope_spec(opts.scopes)
	end
end

function M.reset()
	sink = default_sink
	set_scope_spec(load_env_spec())
end

function M.start(name, attrs)
	if not scope_enabled(name) then
		return noop_span
	end

	return create_span(name, attrs)
end

function M.span(name, attrs, fn)
	if type(attrs) == "function" then
		fn = attrs
		attrs = nil
	end

	local span = M.start(name, attrs)
	if type(fn) ~= "function" then
		return span
	end

	if span.__noop then
		return fn(span)
	end

	local results = table.pack(pcall(fn, span))
	if not results[1] then
		span.failed = true
		span.error = results[2]
		if not span.closed then
			span:close()
		end
		error(results[2], 0)
	end

	if not span.closed then
		span:close()
	end

	return table.unpack(results, 2, results.n)
end

set_scope_spec(load_env_spec())

return M
