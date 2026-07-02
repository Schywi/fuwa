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

local function with_temp_tenant(fn)
	local root = os.tmpname() .. "-shell-host"
	os.execute("mkdir -p " .. shell_quote(root .. "/tenant/pages"))

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
  render "home", title: "Tenant preview", preview_html: preview_html
end
]])
	write_file(root .. "/tenant/view.fuwa", [[
<main>&title</main>
<section class="tenant-preview">&unsafe preview_html</section>
]])

	local ok, err = pcall(fn, root)
	cleanup_tree(root)
	assert(ok, err)
end

return function(t)
	t.test("host mounts the current payload into a sandboxed preview iframe", function()
		local host = host_caps.new({ root_dir = "." })
		local preview = host.mount_payload("preview", "current")

		t.truthy(preview:find('data-host-slot="preview"', 1, true) ~= nil, "expected preview slot attribute")
		t.truthy(preview:find('sandbox="allow-scripts allow-forms"', 1, true) ~= nil, "expected sandboxed iframe")
		t.truthy(preview:find("Fuwa Dev", 1, true) ~= nil, "expected mounted payload content")
	end)

	t.test("host switches to the lesson payload through the primary slot", function()
		local host = host_caps.new({ root_dir = "." })

		local switched = host.switch_payload("lesson")
		t.truthy(switched:find('data-host-slot="primary"', 1, true) ~= nil, "expected primary slot attribute")
		t.truthy(switched:find("Fuwa Lesson", 1, true) ~= nil, "expected lesson payload content")

		local active = host.mount_payload("preview")
		t.truthy(active:find("Fuwa Lesson", 1, true) ~= nil, "expected active payload to track the switch")
	end)

	t.test("tenant payloads cannot resolve host", function()
		with_temp_tenant(function(root)
			local host = host_caps.new({
				root_dir = ".",
				payload_root = root,
			})

			local preview = host.mount_payload("preview", "tenant")
			t.truthy(preview:find("module 'host' not found", 1, true) ~= nil, "expected host capability denial")
		end)
	end)
end
