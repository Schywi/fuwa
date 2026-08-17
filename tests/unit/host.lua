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

function t.eq(actual, expected, label)
	if actual ~= expected then
		error(string.format("%s expected %s, got %s", label or "equality check", tostring(expected), tostring(actual)), 2)
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
	write_file(root .. "/current/browser.js", "document.documentElement.dataset.fuwaBrowser = 'current'\n")
	write_file(root .. "/current/pages/home.fuwa", "module Home\naction index(req) do\n  render \"home\"\nend\n")
	write_file(root .. "/current/views/home.fuwa", "<main>Current payload</main>\n")
	write_file(root .. "/current/views/layout.fuwa", "<html><body><include src=\"views/home.fuwa\" /><script src=\"browser.js\"></script></body></html>\n")

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
	write_file(root .. "/lesson/browser.js", "document.documentElement.dataset.fuwaBrowser = 'lesson'\n")
	write_file(root .. "/lesson/pages/home.fuwa", "module Home\naction index(req) do\n  render \"home\"\nend\n")
	write_file(root .. "/lesson/views/home.fuwa", "<main>Lesson payload</main>\n")
	write_file(root .. "/lesson/views/layout.fuwa", "<html><body><include src=\"views/home.fuwa\" /><script src=\"browser.js\"></script></body></html>\n")

	local ok, err = pcall(fn, root)
	cleanup_tree(root)
	assert(ok, err)
end

local function contains(list, value)
	for _, item in ipairs(list or {}) do
		if item == value then
			return true
		end
	end
	return false
end

t.test("mount_payload returns a route-backed iframe", function()
	with_temp_payloads(function(root)
		local host = host_caps.new({
			root_dir = ".",
			payload_root = root,
		})

		local preview = host.mount_payload("preview", "current")
		t.truthy(preview:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot")
		t.truthy(preview:find('src="/payload/current/"', 1, true) ~= nil, "expected route-backed iframe")
		t.truthy(preview:find('sandbox="allow-scripts allow-forms allow-same-origin"', 1, true) ~= nil, "expected sandboxed iframe")
	end)
end)

t.test("payload metadata and file access work through the host seam", function()
	with_temp_payloads(function(root)
		local host = host_caps.new({
			root_dir = ".",
			payload_root = root,
		})

		local current = host.describe_payload("current")
		t.truthy(current ~= nil, "expected current payload descriptor")
		t.eq(current.label, "Current", "expected humanized payload label")
		t.truthy(contains(current.files, "browser.js"), "expected browser.js in file list")
		t.truthy(contains(current.files, "pages/home.fuwa"), "expected view files in file list")
		t.truthy(host.read_payload_file("current", "browser.js"):find("fuwaBrowser", 1, true) ~= nil, "expected browser.js contents")

		local write_result = host.write_payload_file("current", "pages/home.fuwa", "module Home\nrender \"home\"\n")
		t.truthy(write_result.ok == true, "expected write to succeed")
		t.truthy(host.read_payload_file("current", "pages/home.fuwa"):find("render \"home\"", 1, true) ~= nil, "expected updated file contents")
	end)
end)

t.test("switch_payload updates the active payload and primary slot", function()
	with_temp_payloads(function(root)
		local host = host_caps.new({
			root_dir = ".",
			payload_root = root,
		})

		local current = host.mount_payload("preview", "current")
		t.truthy(current:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot")
		t.truthy(current:find('src="/payload/current/"', 1, true) ~= nil, "expected current payload route")

		local lesson = host.switch_payload("lesson")
		t.truthy(lesson:find('data-host-slot="primary"', 1, true) ~= nil, "expected primary slot")
		t.truthy(lesson:find('src="/payload/lesson/"', 1, true) ~= nil, "expected route-backed mount")

		local active = host.mount_payload("preview")
		t.truthy(active:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot to persist")
		t.truthy(active:find("lesson", 1, true) ~= nil, "expected active payload to persist")
	end)
end)

t.test("compile_payload reports success and diagnostics through the host seam", function()
	with_temp_payloads(function(root)
		local host = host_caps.new({
			root_dir = ".",
			payload_root = root,
		})

		local success = host.compile_payload("current")
		t.truthy(success.ok == true, "expected compile to succeed")
		t.truthy(success.value.success == true, "expected successful payload compile")
		t.truthy(success.value.output:find("Build ok", 1, true) ~= nil, "expected success output")
		t.truthy(success.value.output:find("Preview route: /payload/current/", 1, true) ~= nil, "expected preview route in output")

		host.write_payload_file("current", "pages/home.fuwa", "module Home\naction index(req) do\n  render \"home\"\n")
		local failure = host.compile_payload("current")
		t.truthy(failure.ok == true, "expected compile result envelope")
		t.truthy(failure.value.success == false, "expected failing payload compile")
		t.truthy(failure.value.output:find("Build failed", 1, true) ~= nil, "expected failure output")
		t.truthy(failure.value.output:find("Unexpected EOF while parsing action block", 1, true) ~= nil, "expected diagnostic text")
	end)
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("host unit tests passed (%d tests)", results.passed))
