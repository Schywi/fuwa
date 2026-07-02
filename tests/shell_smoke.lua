package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local compiler = require("runtime.stdlib.compiler")
local package_web = require("runtime.stdlib.compiler.package_web")
local host_caps = require("runtime.host.capabilities")

local function read_file(path)
	local file = assert(io.open(path, "r"))
	local contents = file:read("*a")
	file:close()
	return contents
end

local function collect_files(root)
	local files = {}
	local pipe = assert(io.popen("find " .. root .. " -type f | sort"))

	for path in pipe:lines() do
		local relative = path:sub(#root + 2)
		files[relative] = read_file(path)
	end

	pipe:close()
	return files
end

local function assert_true(condition, message)
	if not condition then
		error(message, 2)
	end
end

local function load_module_source(source, name)
	return assert(load(source, "@" .. name))()
end

local files = collect_files("shell")
local compile_result = compiler.compile_runtime_files(files)
assert_true(#compile_result.diagnostics == 0, "shell should compile cleanly")
assert_true(compile_result.modules["app.lua"] ~= nil, "shell should emit app.lua")
assert_true(compile_result.modules["pages/home.lua"] ~= nil, "shell should emit pages/home.lua")
assert_true(compile_result.modules["view.lua"] ~= nil, "shell should emit view.lua")

local build_result = package_web.build(files)
assert_true(#build_result.diagnostics == 0, "shell packaging should compile cleanly")
assert_true(build_result.run_files["main.lua"] ~= nil, "shell should emit main.lua")

local html
package.loaded["app"] = nil
package.loaded["view"] = nil
package.loaded["pages.home"] = nil
package.loaded["host"] = nil
_G.__fuwa_print = function() end
_G.__fuwa_db_op = function()
	error("shell proof should not touch the database")
end
_G.set_html = function(value)
	html = tostring(value)
end
_G.__fuwa_is_request = false

package.preload["host"] = function()
	return host_caps.new({ root_dir = "." })
end
package.preload["app"] = function()
	return load_module_source(build_result.run_files["app.lua"], "app.lua")
end
package.preload["view"] = function()
	return load_module_source(build_result.run_files["view.lua"], "view.lua")
end
package.preload["pages.home"] = function()
	return load_module_source(build_result.run_files["pages/home.lua"], "pages/home.lua")
end

assert(load(build_result.run_files["main.lua"], "@main.lua"))()
assert_true(type(html) == "string" and html:find("Fuwa Shell", 1, true) ~= nil, "shell should render host branding")
assert_true(html:find("<!DOCTYPE html>", 1, true) == 1, "shell should start with a doctype")
assert_true(html:find("Route-backed tenant iframe", 1, true) ~= nil, "shell should render the route-backed badge")
assert_true(html:find('src="/payload/current/"', 1, true) ~= nil, "shell should mount the tenant route")
assert_true(html:find("tenant-bridge.js", 1, true) == nil, "shell should not include the tenant bridge")
assert_true(html:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "shell should load local htmx")
assert_true(html:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "shell should load local petite-vue")
assert_true(html:find('/vendor/xterm/xterm-6.0.0.css', 1, true) ~= nil, "shell should load local xterm stylesheet")
assert_true(html:find('@codemirror/state', 1, true) ~= nil, "shell should expose the codemirror import map")
assert_true(html:find('/shell/hooks/editor.js', 1, true) ~= nil, "shell should load the editor hook")
assert_true(html:find('/shell/hooks/terminal.js', 1, true) ~= nil, "shell should load the terminal hook")
assert_true(html:find('hx-post="/switch/lesson"', 1, true) ~= nil, "shell should expose a payload switch button")
assert_true(html:find('hx-target="#shell-content"', 1, true) ~= nil, "shell should target the workspace fragment")
assert_true(html:find('hx-post="/save/current"', 1, true) ~= nil, "shell should expose a save action")
assert_true(html:find('Save + run', 1, true) ~= nil, "shell should expose the combined save and run action")
assert_true(html:find('hx-get="/inspect/current?file=pages%2Fhome.fuwa"', 1, true) ~= nil, "shell should expose file inspection links")
assert_true(html:find('data-editor-root', 1, true) ~= nil, "shell should expose the editor root")
assert_true(html:find('data-file-path="pages/home.fuwa"', 1, true) ~= nil, "shell should pass the editor file path")
assert_true(html:find('data-terminal-root', 1, true) ~= nil, "shell should expose the terminal root")
assert_true(html:find('data-terminal-session="current"', 1, true) ~= nil, "shell should pass the terminal session")
assert_true(html:find('No run yet.', 1, true) ~= nil, "shell should seed the terminal output")

print("shell smoke checks passed")
