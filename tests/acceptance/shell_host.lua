local dev = require("runtime.fuwa-dev")
local host_caps = require("runtime.host.capabilities")

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

local function with_temp_roots(fn)
	local root = os.tmpname() .. "-shell-host"
	os.execute("mkdir -p " .. shell_quote(root .. "/current"))
	os.execute("mkdir -p " .. shell_quote(root .. "/lesson"))
	os.execute("mkdir -p " .. shell_quote(root .. "/tenant/pages"))

	write_file(root .. "/current/app.fuwa", [[
module App

routes do
  GET "/" fn(req) do
    return "current"
  end
end
]])
	write_file(root .. "/lesson/app.fuwa", [[
module App

routes do
  GET "/" fn(req) do
    return "lesson"
  end
end
]])
	write_file(root .. "/tenant/app.fuwa", [[
module App

import
  Home "pages/home"
end

routes do
  GET "/" Home.index
end
]])
	write_file(root .. "/tenant/pages/home.fuwa", [[
module Home

use host

action index(req) do
  preview_html = host.mount_payload("preview", "tenant")
  render "home", preview_html: preview_html
end
]])
	write_file(root .. "/tenant/view.fuwa", [[
<main>
  &unsafe preview_html
</main>
]])

	local ok, err = pcall(fn, root)
	cleanup_tree(root)
	assert(ok, err)
end

return function(t)
	t.test("host mounts the current payload route into the preview iframe", function()
		local host = host_caps.new({
			root_dir = ".",
			payload_root = "./payloads",
		})

		local preview = host.mount_payload("preview", "current")
		t.truthy(preview:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot attribute")
		t.truthy(preview:find('src="/payload/current/"', 1, true) ~= nil, "expected current payload route")
		t.truthy(preview:find('sandbox="allow-scripts allow-forms"', 1, true) ~= nil, "expected sandboxed iframe")
	end)

	t.test("host switches to the lesson payload through the primary slot", function()
		local host = host_caps.new({
			root_dir = ".",
			payload_root = "./payloads",
		})

		local switched = host.switch_payload("lesson")
		t.truthy(switched:find('data-host-slot="primary"', 1, true) ~= nil, "expected primary slot attribute")
		t.truthy(switched:find('src="/payload/lesson/"', 1, true) ~= nil, "expected lesson payload route")

		local active = host.mount_payload("preview")
		t.truthy(active:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot attribute")
		t.truthy(active:find('src="/payload/lesson/"', 1, true) ~= nil, "expected active payload to track the switch")
	end)

	t.test("tenant payloads cannot resolve host", function()
		with_temp_roots(function(root)
			local ok, err = pcall(dev.build_response, root .. "/tenant", "GET", "/", "")
			t.truthy(ok == false, "expected tenant payload request to fail")
			t.truthy(tostring(err):find("module 'host' not found", 1, true) ~= nil, "expected host capability denial")
		end)
	end)
end
