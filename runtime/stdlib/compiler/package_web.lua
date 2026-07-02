local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local compiler = require("runtime.stdlib.compiler.init")
local bootstrap = require("runtime.stdlib.compiler.bootstrap")

local M = {}

local function clone_passthrough(files)
	local out = {}
	for name, value in pairs(files) do
		if name:sub(-5) ~= ".fuwa" then
			out[name] = value
		end
	end
	return out
end

function M.build(source_files)
	local diagnostics_out = {}
	local run_files = clone_passthrough(source_files)
	local core = compiler.compile_runtime_files(source_files)

	for _, entry in ipairs(core.diagnostics) do
		diagnostics_out[#diagnostics_out + 1] = entry
	end

	if not source_files["app.fuwa"] then
		diagnostics.add(diagnostics_out, "app.fuwa", 1, "Missing app.fuwa entry file")
	end

	if not source_files["view.fuwa"] then
		diagnostics.add(diagnostics_out, "view.fuwa", 1, "Missing view.fuwa template file")
	end

	if diagnostics.has_errors(diagnostics_out) then
		return {
			diagnostics = diagnostics_out,
			run_files = run_files
		}
	end

	for name, value in pairs(core.modules) do
		run_files[name] = value
	end

	run_files["main.lua"] = bootstrap.build_main_bootstrap()

	return {
		diagnostics = diagnostics_out,
		run_files = run_files
	}
end

return M
