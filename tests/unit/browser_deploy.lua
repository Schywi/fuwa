package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

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

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

function t.falsy(value, label)
	if value then
		error(label or "expected falsy value", 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

t.test("browser deploy exports the in-memory snapshot and posts json", function()
	local session = read_file("shell/hooks/runtime-session.js")
	local preview_browser = read_file("shell/hooks/preview-browser.js")
	local preview = read_file("shell/hooks/preview.js")
	local home = read_file("shell/views/fragments/home.fuwa")
	local handler = read_file("runtime/openresty/deploy/deploy_handler.lua")
	local preview_handler = read_file("runtime/openresty/deploy/preview_handler.lua")
	local public_shell = read_file("runtime/openresty/deploy/public_shell.lua")
	local landing = read_file("payloads/preview-landing/views/fragments/main.fuwa")

	t.contains(session, "async function exportSnapshot()", "expected snapshot export helper")
	t.contains(session, "files: currentSources() || {}", "expected snapshot to use in-memory sources")
	t.contains(preview_browser, "session.exportSnapshot()", "expected browser driver to export snapshot")
	t.contains(preview_browser, "fetch('/__dev/deploy'", "expected deploy post")
	t.contains(preview_browser, "'Content-Type': 'application/json'", "expected json deploy")
	t.contains(preview_browser, "window.location.assign(result.payload.url)", "expected browser redirect")
	t.contains(preview, "[data-deploy-trigger]", "expected explicit deploy trigger")
	t.contains(preview, "browser_driver.deploy()", "expected preview controller to delegate deploy")
	t.contains(home, '<button type="button" class="grafana-trigger" data-deploy-trigger', "expected plain deploy button")
	t.falsy(home:find('href="/__dev/deploy"', 1, true) ~= nil, "expected no deploy anchor")
	t.contains(handler, "method ~= \"POST\"", "expected deploy handler to reject non-post methods")
	t.falsy(handler:find("collect_payload_files", 1, true) ~= nil, "expected deploy handler to avoid server-side payload collection")
	t.falsy(handler:find("/.fuwa%-dev/drafts/current", 1) ~= nil, "expected deploy handler to avoid draft overlay reads")
	t.contains(landing, 'src="/p/current/app"', "expected landing source template")
	t.falsy(preview_handler:find('/?app=1', 1, true) ~= nil, "expected no preview mount query hack")
	t.contains(preview_handler, 'subpath == "/app"', "expected iframe app route contract")
	t.contains(preview_handler, 'mount_path .. "/app"', "expected app root rebasing")
	t.contains(public_shell, "if (url === '/')", "expected root route rebasing")
end)

if results.failed > 0 then
	io.stderr:write(table.concat(results.failures, "\n\n") .. "\n")
	os.exit(1)
end

print(string.format("ok - %d assertions groups", results.passed))
