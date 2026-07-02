package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local compiler = require("runtime.stdlib.compiler")
local package_web = require("runtime.stdlib.compiler.package_web")

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
_G.__fuwa_print = function() end
_G.__fuwa_db_op = function()
	error("shell proof should not touch the database")
end
_G.set_html = function(value)
	html = tostring(value)
end
_G.__fuwa_is_request = false

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
assert_true(type(html) == "string" and html:find("Fuwa host shell", 1, true) ~= nil, "shell should render host branding")
assert_true(html:find("Phase 1 proof", 1, true) ~= nil, "shell should render phase 1 proof copy")

print("shell smoke checks passed")
