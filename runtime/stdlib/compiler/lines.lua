local strings = require("runtime.stdlib.compiler.strings")

local M = {}

function M.split(source)
	local normalized = tostring(source or ""):gsub("\r\n", "\n"):gsub("\r", "\n")
	local lines = {}

	for line in (normalized .. "\n"):gmatch("([^\n]*)\n") do
		lines[#lines + 1] = line
	end

	return lines
end

function M.is_blank_or_comment(line)
	local trimmed = strings.trim(line)
	return trimmed == "" or trimmed:sub(1, 2) == "--"
end

return M
