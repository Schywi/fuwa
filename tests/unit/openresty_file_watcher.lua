package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local watcher = require("runtime.openresty.file_watcher")

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

local function write_file(path, contents)
	local file = assert(io.open(path, "wb"))
	file:write(contents or "")
	file:close()
end

local function read_command_output(command)
	local pipe = assert(io.popen(command, "r"))
	local output = pipe:read("*a") or ""
	local ok, _, code = pipe:close()
	if ok == false then
		error(string.format("command failed (%s): %s", tostring(code), command), 2)
	end
	return output
end

local function ensure_dir(path)
	assert(os.execute("mkdir -p " .. string.format("%q", path)))
end

local function remove_tree(path)
	assert(os.execute("rm -rf " .. string.format("%q", path)))
end

t.test("ignore rules skip internal watcher directories only", function()
	t.truthy(watcher.should_ignore_relative_path(".git/index"), "expected .git to be ignored")
	t.truthy(watcher.should_ignore_relative_path(".fuwa-dev/reload-token"), "expected .fuwa-dev to be ignored")
	t.falsy(watcher.should_ignore_relative_path("runtime/openresty/init.lua"), "expected runtime sources to be watched")
	t.falsy(watcher.should_ignore_relative_path("docs/openresty/README.md"), "expected docs to be watched")
end)

t.test("change detection fires on same-size edits", function()
	local previous = {
		["runtime/example.lua"] = "3:1000.0"
	}
	local current = {
		["runtime/example.lua"] = "3:1001.0"
	}

	t.truthy(watcher.has_changes(previous, current), "expected modified timestamp changes to reload even when size is stable")
end)

t.test("signature scan covers the repo and excludes watcher churn", function()
	local root = os.tmpname() .. "-watcher"
	remove_tree(root)
	ensure_dir(root)
	ensure_dir(root .. "/runtime")
	ensure_dir(root .. "/docs")
	ensure_dir(root .. "/.git")
	ensure_dir(root .. "/.fuwa-dev")

	write_file(root .. "/runtime/app.lua", "return 'one'\n")
	write_file(root .. "/docs/note.md", "hello\n")
	write_file(root .. "/.git/internal", "ignored\n")
	write_file(root .. "/.fuwa-dev/reload-token", "ignored\n")

		local first = watcher.collect_signatures(root)
		t.truthy(first["runtime/app.lua"] ~= nil, "expected runtime file to be watched")
		t.truthy(first["docs/note.md"] ~= nil, "expected docs file to be watched")
		t.falsy(first[".git/internal"] ~= nil, "expected .git contents to be ignored")
		t.falsy(first[".fuwa-dev/reload-token"] ~= nil, "expected .fuwa-dev contents to be ignored")

		os.execute("sleep 1")
		write_file(root .. "/runtime/app.lua", "return 'two'\n")

		local second = watcher.collect_signatures(root)
		t.truthy(watcher.has_changes(first, second), "expected repo scan to detect same-size content edits")

	remove_tree(root)
end)

if results.failed > 0 then
	io.stderr:write(string.format("FAIL %d/%d openresty file watcher tests failed\n", results.failed, results.passed + results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write("\n" .. failure .. "\n")
	end
	os.exit(1)
end

io.stdout:write(string.format("PASS %d openresty file watcher tests\n", results.passed))
