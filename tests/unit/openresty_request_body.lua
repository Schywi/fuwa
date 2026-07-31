package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local request_body = require("runtime.openresty.request_body")

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

local function write_file(path, contents)
	local file = assert(io.open(path, "wb"))
	file:write(contents or "")
	file:close()
end

t.test("request body reader prefers in-memory request bodies", function()
	local called = 0
	local body, err = request_body.read({
		read_body = function()
			called = called + 1
		end,
		get_body_data = function()
			return '{"ok":true}'
		end,
		get_body_file = function()
			return nil
		end
	})

	t.eq(called, 1, "expected read_body call")
	t.eq(body, '{"ok":true}', "expected in-memory body")
	t.eq(err, nil, "expected no error")
end)

t.test("request body reader falls back to nginx temp body file", function()
	local path = os.tmpname()
	write_file(path, '{"ok":true,"source":"file"}')
	local body, err = request_body.read({
		read_body = function() end,
		get_body_data = function()
			return nil
		end,
		get_body_file = function()
			return path
		end
	})
	os.remove(path)

	t.eq(body, '{"ok":true,"source":"file"}', "expected file-backed body")
	t.eq(err, nil, "expected no error")
end)

t.test("request body reader reports empty body when nothing is available", function()
	local body, err = request_body.read({
		read_body = function() end,
		get_body_data = function()
			return nil
		end,
		get_body_file = function()
			return nil
		end
	})

	t.eq(body, nil, "expected no body")
	t.eq(err, "empty body", "expected empty body error")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n") .. "\n")
	os.exit(1)
end

print(string.format("ok - %d assertion groups", results.passed))
