local compiler = require("runtime.stdlib.compiler")
local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local modules = require("runtime.stdlib.compiler.modules")
local package_web = require("runtime.stdlib.compiler.package_web")

local M = {}

function M.lines(source)
	local out = {}
	local text = tostring(source or ""):gsub("\r\n", "\n"):gsub("\r", "\n")

	for line in (text .. "\n"):gmatch("([^\n]*)\n") do
		out[#out + 1] = line
	end

	return out
end

function M.context(source, filename)
	return {
		filename = filename or "test.fuwa",
		lines = M.lines(source),
		out = {},
		diagnostics = {},
		imports = {},
		imports_emitted = false,
		action_bootstrap_emitted = false,
		has_actions = false,
		module_name = nil,
		mode = nil
	}
end

function M.join(lines)
	return table.concat(lines or {}, "\n")
end

function M.compile_module(source, filename)
	return modules.compile_module_source(source, filename or "test.fuwa")
end

function M.compile_view(source)
	return modules.compile_view_source(source or "")
end

function M.compile_runtime(files)
	return compiler.compile_runtime_files(files)
end

function M.package_web(files)
	return package_web.build(files)
end

function M.format_diagnostics(entries)
	return diagnostics.format(entries or {})
end

function M.load_chunk(source, name)
	return assert(load(source, "@" .. (name or "chunk")))
end

return M
