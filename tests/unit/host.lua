package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local host_caps = require("runtime.host.capabilities")

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

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", [['"'"']]) .. "'"
end

local function write_file(path, contents)
	local file = assert(io.open(path, "wb"))
	file:write(contents or "")
	file:close()
end

local function cleanup_tree(root)
	os.execute("rm -rf " .. shell_quote(root))
end

local function with_temp_payloads(fn)
	local root = os.tmpname() .. "-host-unit"
	os.execute("mkdir -p " .. shell_quote(root .. "/current/pages"))
	os.execute("mkdir -p " .. shell_quote(root .. "/current/views"))
	os.execute("mkdir -p " .. shell_quote(root .. "/lesson/pages"))
	os.execute("mkdir -p " .. shell_quote(root .. "/lesson/views"))

	write_file(root .. "/current/app.fuwa", [[
module App

import
  Home "pages/home"
end

routes do
  GET "/" Home.index
end
]])
	write_file(root .. "/current/view.fuwa", [[
<include src="views/layout.fuwa" />
]])
	write_file(root .. "/current/pages/home.fuwa", "module Home\nend\n")
	write_file(root .. "/current/views/home.fuwa", "<main>Current payload</main>\n")
	write_file(root .. "/current/views/layout.fuwa", "<html><body><include src=\"views/home.fuwa\" /></body></html>\n")

	write_file(root .. "/lesson/app.fuwa", [[
module App

import
  Home "pages/home"
end

routes do
  GET "/" Home.index
end
]])
	write_file(root .. "/lesson/view.fuwa", [[
<include src="views/layout.fuwa" />
]])
	write_file(root .. "/lesson/pages/home.fuwa", "module Home\nend\n")
	write_file(root .. "/lesson/views/home.fuwa", "<main>Lesson payload</main>\n")
	write_file(root .. "/lesson/views/layout.fuwa", "<html><body><include src=\"views/home.fuwa\" /></body></html>\n")

	local ok, err = pcall(fn, root)
	cleanup_tree(root)
	assert(ok, err)
end

t.test("switch_payload updates the active payload and primary slot", function()
	with_temp_payloads(function(root)
		local host = host_caps.new({
			root_dir = ".",
			payload_root = root,
		})

		local current = host.mount_payload("preview", "current")
		t.truthy(current:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot")
		t.truthy(current:find('src="/payload/current/"', 1, true) ~= nil, "expected current payload route")
		t.truthy(current:find("sandbox=\"allow-scripts allow-forms\"", 1, true) ~= nil, "expected sandboxed iframe")

		local lesson = host.switch_payload("lesson")
		t.truthy(lesson:find('data-host-slot="primary"', 1, true) ~= nil, "expected primary slot")
		t.truthy(lesson:find('src="/payload/lesson/"', 1, true) ~= nil, "expected lesson payload route")

		local active = host.mount_payload("preview")
		t.truthy(active:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot to persist")
		t.truthy(active:find('src="/payload/lesson/"', 1, true) ~= nil, "expected active payload to persist")
	end)
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("host unit tests passed (%d tests)", results.passed))
