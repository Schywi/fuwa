package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local browser = require("runtime.browser")

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

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

t.test("browser worker contract exposes the bootstrap message set", function()
	local types = browser.contract.message_types()
	t.eq(#types, 6, "expected six message types")
	t.eq(types[1], "boot", "expected boot message")
	t.eq(types[2], "load_payload", "expected load_payload message")
	t.eq(types[3], "handle_request", "expected handle_request message")
	t.eq(types[4], "set_html", "expected set_html message")
	t.eq(types[5], "log_event", "expected log_event message")
	t.eq(types[6], "fatal", "expected fatal message")

	local boot_message = browser.contract.make_message("boot", {
		payload_id = "current",
		slot = "preview"
	})
	t.truthy(browser.contract.is_message(boot_message), "expected browser contract marker")
	t.eq(boot_message.__fuwaBrowser, true, "expected browser marker")
	t.eq(boot_message.type, "boot", "expected boot type")
	t.eq(boot_message.payload_id, "current", "expected payload id")
	t.eq(boot_message.slot, "preview", "expected slot")

	local request_message = browser.contract.make_message("handle_request", {
		body = "",
		method = "GET",
		path = "/"
	})
	t.truthy(browser.contract.is_message(request_message), "expected request message to match the contract")
	t.eq(request_message.type, "handle_request", "expected request type")
	t.eq(request_message.method, "GET", "expected request method")
	t.eq(request_message.path, "/", "expected request path")
	t.eq(request_message.body, "", "expected request body")
end)

t.test("browser runtime bootstrap stays a thin seam", function()
	local mount = browser.bootstrap.build_mount_descriptor("preview", "current")
	t.eq(mount.kind, "browser_runtime", "expected browser runtime mount")
	t.eq(mount.slot, "preview", "expected preview slot")
	t.eq(mount.payload_id, "current", "expected current payload")
	t.eq(mount.root_id, "app", "expected stable root id")
	t.eq(mount.sandbox, "allow-scripts allow-forms allow-same-origin", "expected iframe sandbox")
	t.eq(#mount.messages, 6, "expected worker contract in the mount descriptor")
	t.eq(mount.messages[1], "boot", "expected contract message order")
	t.eq(mount.messages[6], "fatal", "expected contract message order")
	t.contains(mount.srcdoc, '<div id="app"></div>', "expected stable runtime root")
	t.contains(mount.srcdoc, 'data-browser-runtime="tenant"', "expected runtime marker")
	t.falsy(mount.srcdoc:find("<script", 1, true) ~= nil, "expected no widget scripts in the scaffold")
	t.falsy(mount.srcdoc:find("vendor", 1, true) ~= nil, "expected no vendor assets in the scaffold")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("browser unit tests passed (%d tests)", results.passed))
