local M = {}

function M.add(diagnostics, file, line, message, snippet, level)
	diagnostics[#diagnostics + 1] = {
		level = level or "error",
		file = file,
		line = line,
		message = message,
		snippet = snippet
	}
end

function M.has_errors(diagnostics)
	for _, diagnostic in ipairs(diagnostics) do
		if diagnostic.level == "error" then
			return true
		end
	end

	return false
end

function M.format(diagnostics)
	local parts = {}

	for _, diagnostic in ipairs(diagnostics) do
		local location = diagnostic.file or "?"
		if diagnostic.line ~= nil then
			location = string.format("%s:%s", location, diagnostic.line)
		end

		local entry = string.format("%s\n  %s", location, diagnostic.message or "unknown error")
		if diagnostic.snippet and diagnostic.snippet ~= "" then
			entry = entry .. "\n  " .. diagnostic.snippet
		end

		parts[#parts + 1] = entry
	end

	return table.concat(parts, "\n\n")
end

return M
