local M = {}

local DEFAULT_ROOT = "/app"
local DEFAULT_IGNORED_DIRS = {
	".fuwa-dev",
	".git",
}

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", [['"'"']]) .. "'"
end

local function escape_lua_pattern(value)
	return (tostring(value):gsub("([^%w])", "%%%1"))
end

function M.should_ignore_relative_path(path, ignored_dirs)
	local normalized = tostring(path or ""):gsub("^%./+", ""):gsub("^/+", "")
	for _, ignored_dir in ipairs(ignored_dirs or DEFAULT_IGNORED_DIRS) do
		local escaped = escape_lua_pattern(ignored_dir)
		if normalized == ignored_dir or normalized:match("^" .. escaped .. "/") then
			return true
		end
	end
	return false
end

function M.build_find_command(root_dir, ignored_dirs)
	local root = tostring(root_dir or DEFAULT_ROOT)
	local ignored = ignored_dirs or DEFAULT_IGNORED_DIRS
	local pruned_paths = {}

	for _, ignored_dir in ipairs(ignored) do
		local absolute = root .. "/" .. ignored_dir
		pruned_paths[#pruned_paths + 1] = "-path " .. shell_quote(absolute)
		pruned_paths[#pruned_paths + 1] = "-path " .. shell_quote(absolute .. "/*")
	end

	return table.concat({
		"find " .. shell_quote(root),
		"\\(",
		table.concat(pruned_paths, " -o "),
		"\\) -prune -o",
		"-type f -printf '%P\\t%s\\t%T@\\n' | sort",
	}, " ")
end

function M.collect_signatures(root_dir, ignored_dirs)
	local signatures = {}
	local command = M.build_find_command(root_dir, ignored_dirs)
	local pipe = assert(io.popen(command, "r"))

	for line in pipe:lines() do
		local relative_path, size, modified_at = line:match("^(.-)\t([^\t]+)\t([^\t]+)$")
		if relative_path and not M.should_ignore_relative_path(relative_path, ignored_dirs) then
			signatures[relative_path] = tostring(size) .. ":" .. tostring(modified_at)
		end
	end

	pipe:close()
	return signatures
end

function M.has_changes(previous, current)
	for path, signature in pairs(current or {}) do
		if (previous or {})[path] ~= signature then
			return true
		end
	end

	for path, _ in pairs(previous or {}) do
		if (current or {})[path] == nil then
			return true
		end
	end

	return false
end

return M
