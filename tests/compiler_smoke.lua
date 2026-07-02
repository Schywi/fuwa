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

local function run_happy_fixture()
	local files = collect_files("tests/fixtures/compiler/happy")
	local compile_result = compiler.compile_runtime_files(files)
	assert_true(#compile_result.diagnostics == 0, "happy fixture should compile cleanly")
	assert_true(compile_result.modules["app.lua"] ~= nil, "happy fixture should emit app.lua")
	assert_true(compile_result.modules["pages/home.lua"] ~= nil, "happy fixture should emit pages/home.lua")
	assert_true(compile_result.modules["view.lua"] ~= nil, "happy fixture should emit view.lua")

	local build_result = package_web.build(files)
	assert_true(#build_result.diagnostics == 0, "happy fixture packaging should compile cleanly")
	assert_true(build_result.run_files["main.lua"] ~= nil, "happy fixture should emit main.lua")

	local html
	_G.__fuwa_print = function() end
	_G.__fuwa_db_op = function()
		error("happy fixture should not touch the database")
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
	assert_true(type(html) == "string" and html:find("hello", 1, true) ~= nil, "happy fixture should render HTML")
end

local function run_payload_fixture(name)
	local files = collect_files("tests/fixtures/compiler/" .. name)
	local compile_result = compiler.compile_runtime_files(files)
	assert_true(#compile_result.diagnostics == 0, name .. " should compile cleanly")

	local build_result = package_web.build(files)
	assert_true(#build_result.diagnostics == 0, name .. " packaging should compile cleanly")
	assert_true(build_result.run_files["main.lua"] ~= nil, name .. " should emit main.lua")
	assert_true(build_result.run_files["view.lua"] ~= nil, name .. " should emit view.lua")
end

local function run_broken_fixture()
	local files = collect_files("tests/fixtures/compiler/broken")
	local compile_result = compiler.compile_runtime_files(files)
	assert_true(#compile_result.diagnostics > 0, "broken fixture should report diagnostics")

	local build_result = package_web.build(files)
	assert_true(#build_result.diagnostics > 0, "broken fixture packaging should report diagnostics")
	assert_true(build_result.run_files["main.lua"] == nil, "broken fixture should not emit main.lua")
end

run_happy_fixture()
run_payload_fixture("fuwa-gomen")
run_payload_fixture("gomen-v2")
run_broken_fixture()

print("compiler smoke checks passed")
