package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local dev = require("runtime.fuwa-dev")
local db = require("runtime.db")

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

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

t.test("fuwa-gomen layout is full-bleed in the tenant document", function()
	local layout = read_file("payloads/fuwa-gomen/views/layout.fuwa")

	t.contains(layout, "html,\n      body {", "expected html/body framing block")
	t.contains(layout, "body {\n        overflow: hidden;\n        background: #fff8ef;", "expected full-bleed body background")
	t.contains(layout, ".phone-screen {\n        width: 100%;\n        min-height: 100%;\n        height: 100%;", "expected phone screen to fill the iframe")
	t.falsy(layout:find('class="gomen%-shell"', 1, false) ~= nil, "expected no centered wrapper class")
end)

t.test("fuwa-gomen rendered document keeps the full-bleed contract", function()
	local response = dev.build_response("payloads/fuwa-gomen", "GET", "/", "", {
		db_provider = db.new("memory"),
	})

	t.truthy(response.status == 200, "expected payload response to succeed")
	t.contains(response.body, 'id="gomen"', "expected gomen root")
	t.contains(response.body, "background: #fff8ef;", "expected rendered full-bleed background")
	t.contains(response.body, 'class="phone-screen"', "expected phone-screen container")
	t.falsy(response.body:find('class="gomen%-shell"', 1, false) ~= nil, "expected no centered wrapper in output")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("fuwa-gomen layout tests passed (%d tests)", results.passed))
