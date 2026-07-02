local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local modules = require("runtime.stdlib.compiler.modules")

local M = {}

function M.format_build_diagnostics(entries)
	return diagnostics.format(entries or {})
end

function M.compile_runtime_files(source_files)
	local modules_out = {}
	local diagnostics_out = {}
	local names = {}

	for file_name in pairs(source_files) do
		names[#names + 1] = file_name
	end

	table.sort(names)

	for _, file_name in ipairs(names) do
		local source = source_files[file_name]
		if file_name:sub(-5) == ".fuwa" then
			local result
			if file_name == "view.fuwa" then
				result = modules.compile_view_source(source, source_files, file_name)
			elseif file_name:match("^views/.+%.fuwa$") then
				result = {
					lua = nil,
					diagnostics = {}
				}
			else
				result = modules.compile_module_source(source, file_name)
			end

			if result.diagnostics then
				for _, entry in ipairs(result.diagnostics) do
					diagnostics_out[#diagnostics_out + 1] = entry
				end
			end

			if result.lua ~= nil then
				local target_name = file_name:gsub("%.fuwa$", ".lua")
				modules_out[target_name] = result.lua
			end
		end
	end

	return {
		diagnostics = diagnostics_out,
		modules = modules_out
	}
end

return M
