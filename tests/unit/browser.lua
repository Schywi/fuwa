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
	t.eq(#types, 8, "expected eight message types")
	t.eq(types[1], "boot", "expected boot message")
	t.eq(types[2], "booted", "expected booted message")
	t.eq(types[3], "boot_error", "expected boot_error message")
	t.eq(types[4], "run", "expected run message")
	t.eq(types[5], "stdout", "expected stdout message")
	t.eq(types[6], "stderr", "expected stderr message")
	t.eq(types[7], "html", "expected html message")
	t.eq(types[8], "done", "expected done message")

	local boot_message = browser.contract.make_message("boot", {
		payload_id = "current",
		slot = "preview"
	})
	t.truthy(browser.contract.is_message(boot_message), "expected browser contract marker")
	t.eq(boot_message.__fuwaBrowser, true, "expected browser marker")
	t.eq(boot_message.type, "boot", "expected boot type")
	t.eq(boot_message.payload_id, "current", "expected payload id")
	t.eq(boot_message.slot, "preview", "expected slot")

	local run_message = browser.contract.make_message("run", {
		id = 1,
		target = { kind = "request", method = "GET", path = "/" }
	})
	t.truthy(browser.contract.is_message(run_message), "expected run message to match the contract")
	t.eq(run_message.type, "run", "expected run type")
	t.eq(run_message.id, 1, "expected run id")
	t.eq(run_message.target.method, "GET", "expected request method")
	t.eq(run_message.target.path, "/", "expected request path")
end)

t.test("browser runtime bootstrap stays a thin seam", function()
	local mount = browser.bootstrap.build_mount_descriptor("preview", "current")
	t.eq(mount.kind, "browser_runtime", "expected browser runtime mount")
	t.eq(mount.slot, "preview", "expected preview slot")
	t.eq(mount.payload_id, "current", "expected current payload")
	t.eq(mount.root_id, "app", "expected stable root id")
	t.eq(mount.sandbox, "allow-scripts allow-forms allow-same-origin", "expected iframe sandbox")
	t.eq(#mount.messages, 8, "expected worker contract in the mount descriptor")
	t.eq(mount.messages[1], "boot", "expected contract message order")
	t.eq(mount.messages[8], "done", "expected contract message order")
	t.eq(mount.bundle_url, "/runtime/current/bundle.json", "expected bundle route")
	t.eq(mount.worker_url, "/shell/hooks/runtime-worker.js", "expected worker asset route")
	t.contains(mount.srcdoc, '<div id="app"></div>', "expected stable runtime root")
	t.contains(mount.srcdoc, 'data-browser-runtime="tenant"', "expected runtime marker")
	t.falsy(mount.srcdoc:find("<script", 1, true) ~= nil, "expected no widget scripts in the scaffold")
	t.falsy(mount.srcdoc:find("vendor", 1, true) ~= nil, "expected no vendor assets in the scaffold")
end)

t.test("runtime tenant document ships the vendor widget stack and bridge", function()
	local srcdoc = browser.bootstrap.build_runtime_srcdoc()
	t.contains(srcdoc, '<div id="app"></div>', "expected stable runtime root")
	t.contains(srcdoc, 'data-browser-runtime="tenant"', "expected runtime marker")
	t.contains(srcdoc, "/vendor/htmx/htmx-1.9.12.min.js", "expected vendor-local htmx")
	t.contains(srcdoc, "/vendor/petite-vue/petite-vue-0.4.1.iife.js", "expected vendor-local petite-vue")
	t.contains(srcdoc, "/shell/hooks/tenant-runtime.js", "expected tenant bridge script")
end)

t.test("bundle build compiles payload sources plus the stdlib VFS", function()
	local sources = {
		["app.fuwa"] = table.concat({
			"module App",
			"",
			"import",
			'  Home "pages/home"',
			"end",
			"",
			"routes do",
			'  GET "/" Home.index',
			"end",
		}, "\n"),
		["pages/home.fuwa"] = table.concat({
			"module Home",
			"",
			"action index(req) do",
			'  return "<h1>hi</h1>"',
			"end",
		}, "\n"),
		["view.fuwa"] = "<main>&unsafe body</main>\n",
	}
	local stdlib = { ["runtime/stdlib/result.lua"] = "return {}" }

	local bundle = browser.bundle.build(sources, stdlib)
	t.truthy(bundle.ok, "expected clean bundle build")
	t.eq(bundle.entry, "main.lua", "expected main.lua entry")
	t.truthy(bundle.files["main.lua"] ~= nil, "expected compiled main.lua")
	t.eq(bundle.files["runtime/stdlib/result.lua"], "return {}", "expected stdlib source in VFS")

	local json = browser.bundle.to_json(bundle)
	t.contains(json, '"ok":true', "expected ok flag in JSON")
	t.contains(json, '"entry":"main.lua"', "expected entry in JSON")
	t.contains(json, '"main.lua":', "expected main.lua key in JSON")

	local broken = browser.bundle.build({ ["app.fuwa"] = "module App\n\nroutes do\nGET" }, stdlib)
	t.falsy(broken.ok, "expected failed bundle build")
	t.truthy(#broken.diagnostics > 0, "expected diagnostics text")
end)

t.test("json encoder escapes strings and keeps arrays", function()
	local json = browser.json.encode({
		list = { 1, 2, 3 },
		text = 'a"b\nc',
		flag = true,
	})
	t.eq(json, '{"flag":true,"list":[1,2,3],"text":"a\\"b\\nc"}', "expected deterministic JSON encoding")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n"), "\n")
	os.exit(1)
end

print(string.format("browser unit tests passed (%d tests)", results.passed))
