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

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
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

t.test("browser worker imports sqlite-wasm instead of sql.js", function()
	local worker = read_file("shell/hooks/runtime-worker.js")
	t.contains(worker, "/vendor/sqlite-wasm/index.mjs", "expected sqlite-wasm module import")
	t.contains(worker, "/vendor/sqlite-wasm/sqlite3.wasm", "expected sqlite-wasm wasm asset")
	t.falsy(worker:find("sqljs", 1, true) ~= nil, "expected no sql.js backend")
end)

t.test("runtime bridge rebinds browser URLs through the payload base", function()
	local session = read_file("shell/hooks/runtime-session.js")
	t.contains(session, "resolveResponseUrl", "expected response URL resolution")
	t.contains(session, "appBasePath", "expected payload base propagation")
	t.contains(session, "responseUrl", "expected response URL propagation")
	t.contains(session, "payload_base_url", "expected derived payload base")

	local tenant = read_file("shell/hooks/tenant-runtime.js")
	t.contains(tenant, "rewriteDocumentUrls", "expected tenant URL rewrite helper")
	t.contains(tenant, "hx-push-url", "expected hx url rewriting")
	t.contains(tenant, "fresh.async = false", "expected ordered script replay")
	t.contains(tenant, "responseUrl", "expected response URL contract")
	t.contains(tenant, "window.location.href", "expected same-origin URL resolution")
end)

t.test("payload browser bootstraps wait for vendor libraries", function()
	local current_browser = read_file("payloads/current/browser.js")
	t.contains(current_browser, "dependenciesReady", "expected dependency probe")
	t.contains(current_browser, "function handleSwap(event)", "expected swap listener helper")
	t.contains(current_browser, "document.addEventListener('htmx:afterSwap', handleSwap);", "expected swap listener registration")
	t.contains(current_browser, "setTimeout(function () {", "expected retry loop")

	local lesson_browser = read_file("payloads/lesson/browser.js")
	t.contains(lesson_browser, "dependenciesReady", "expected lesson dependency probe")
	t.contains(lesson_browser, "function handleSwap(event)", "expected lesson swap listener helper")
	t.contains(lesson_browser, "document.addEventListener('htmx:afterSwap', handleSwap);", "expected lesson swap listener registration")
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

t.test("dev bundles ship raw sources for in-worker compiles", function()
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

	local plain = browser.bundle.build(sources, stdlib)
	t.falsy(plain.sources, "expected no raw sources in the plain bundle")
	t.falsy(browser.bundle.to_json(plain):find('"sources":', 1, true) ~= nil,
		"expected no sources key in plain bundle JSON")

	local dev_bundle = browser.bundle.build(sources, stdlib, { include_sources = true })
	t.truthy(dev_bundle.ok, "expected clean dev bundle build")
	t.eq(dev_bundle.sources["app.fuwa"], sources["app.fuwa"], "expected raw app source in dev bundle")
	t.eq(dev_bundle.sources["view.fuwa"], sources["view.fuwa"], "expected raw view source in dev bundle")
	t.contains(browser.bundle.to_json(dev_bundle), '"sources":', "expected sources key in dev bundle JSON")
end)

t.test("the compiler runs in a worker-shaped sandbox and recompiles edits", function()
	-- Collect the compiler + stdlib into a VFS, exactly what a dev bundle ships.
	local vfs = {}
	local pipe = assert(io.popen("find runtime/stdlib -name '*.lua' 2>/dev/null | sort", "r"))
	for path in pipe:lines() do
		vfs[path] = read_file(path)
	end
	pipe:close()
	-- The compiler's init.lua reaches out to the host trace module (which pulls
	-- in log); the dev bundle ships both, so the sandbox VFS must too.
	vfs["runtime/trace.lua"] = read_file("runtime/trace.lua")
	vfs["runtime/log.lua"] = read_file("runtime/log.lua")

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
			'  return "<h1>before-edit</h1>"',
			"end",
		}, "\n"),
		["view.fuwa"] = "<main>&unsafe body</main>\n",
	}

	-- Worker-shaped environment: VFS-only searcher, no io, no os.
	local saved_loaded = {}
	for name in pairs(package.loaded) do
		if name:match("^runtime%.") then
			saved_loaded[name] = package.loaded[name]
			package.loaded[name] = nil
		end
	end
	local saved_searchers = package.searchers
	package.searchers = { saved_searchers[1], function(modname)
		local path = modname:gsub("%.", "/") .. ".lua"
		local code = vfs[path]
		if code then
			return load(code, "@" .. path)
		end
		return "\n\tno file '" .. path .. "' in VFS"
	end }
	local real_io, real_os = io, os
	io = setmetatable({}, { __index = function(_, k) error("io." .. k .. " called in sandbox") end })
	-- Mirror the worker (openStandardLibs: true, but no real filesystem/process):
	-- allow the benign clock/env reads the compiler's trace dependency performs,
	-- while still trapping disk/process side effects (execute, remove, exit, …).
	os = setmetatable({
		getenv = function() return nil end,
		time = real_os.time,
		clock = real_os.clock,
	}, { __index = function(_, k) error("os." .. k .. " called in sandbox") end })

	local ok, result = pcall(function()
		local package_web = require("runtime.stdlib.compiler.package_web")
		local diag = require("runtime.stdlib.compiler.diagnostics")

		local function all_output(build)
			local names = {}
			for name in pairs(build.run_files) do
				names[#names + 1] = name
			end
			table.sort(names)
			local parts = {}
			for _, name in ipairs(names) do
				parts[#parts + 1] = build.run_files[name]
			end
			return table.concat(parts, "\n")
		end

		local first = package_web.build(sources)
		assert(not diag.has_errors(first.diagnostics), "first sandbox build failed")
		assert(all_output(first):find("before-edit", 1, true), "expected first build output")

		-- Simulate a live edit and recompile, like the worker does per change.
		local edited = {}
		for name, code in pairs(sources) do
			edited[name] = code
		end
		edited["pages/home.fuwa"] = edited["pages/home.fuwa"]:gsub("before%-edit", "after-edit")
		local second = package_web.build(edited)
		assert(not diag.has_errors(second.diagnostics), "edited sandbox build failed")
		return all_output(second)
	end)

	io, os = real_io, real_os
	package.searchers = saved_searchers
	for name in pairs(package.loaded) do
		if name:match("^runtime%.") then
			package.loaded[name] = nil
		end
	end
	for name, module in pairs(saved_loaded) do
		package.loaded[name] = module
	end

	t.truthy(ok, "sandbox compile failed: " .. tostring(result))
	t.contains(result, "after-edit", "expected the edited source in the recompiled output")
	t.falsy(result:find("before-edit", 1, true) ~= nil, "expected the old output to be gone")
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
