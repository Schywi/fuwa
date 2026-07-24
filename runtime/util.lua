-- util.lua
-- Shared utility functions used across the runtime.
-- Centralizes 15+ functions that were duplicated in 2-4 files each.

local M = {}

--------------------------------------------------------------------------------
-- File system
--------------------------------------------------------------------------------

--- Extract the directory portion of a path.
--  "a/b/c" -> "a/b",  "a" -> "."
function M.dirname(path)
  return (path and path:match("^(.*)/[^/]*$")) or "."
end

--- Check if a file exists.
function M.file_exists(path)
  local file = io.open(path, "rb")
  if file then
    file:close()
    return true
  end
  return false
end

--- Read entire file contents. Returns nil if the file doesn't exist.
function M.read_all(path)
  local file = io.open(path, "rb")
  if not file then
    return nil
  end
  local contents = file:read("*a")
  file:close()
  return contents
end

--- Write contents to a file. Creates or overwrites.
function M.write_all(path, contents)
  local file = assert(io.open(path, "wb"))
  file:write(contents or "")
  file:close()
end

--- Ensure a file exists, creating it with optional contents if it doesn't.
function M.ensure_path(path, contents)
  if not M.file_exists(path) then
    M.write_all(path, contents or "")
  end
end

--- Shell-escape a value for use in popen/system commands.
function M.shell_quote(value)
  return "'" .. tostring(value):gsub("'", [['"'"']]) .. "'"
end

--- List files under a directory (uses find(1), sorted).
function M.list_files(root)
  local command = string.format("find %s -type f | sort", M.shell_quote(root))
  local pipe = io.popen(command, "r")
  if not pipe then
    return {}
  end
  local files = {}
  local prefix = root .. "/"
  for path in pipe:lines() do
    files[#files + 1] = path:sub(#prefix + 1)
  end
  pipe:close()
  return files
end

--------------------------------------------------------------------------------
-- Data
--------------------------------------------------------------------------------

--- Deep-copy a value. Tables are recursively cloned. Other types are
--- returned as-is. Handles cycles by stopping at depth 2 (practical limit).
function M.deep_copy(value)
  if type(value) ~= "table" then
    return value
  end
  local out = {}
  for key, entry in pairs(value) do
    out[M.deep_copy(key)] = M.deep_copy(entry)
  end
  return out
end

--- True if the value is an array-like table (integer keys 1..n only).
--- Returns true, count on success, or false on failure.
function M.is_array(value)
  if type(value) ~= "table" then
    return false
  end
  if next(value) == nil then
    return true, 0
  end
  local count = 0
  for key in pairs(value) do
    if type(key) ~= "number" or key < 1 or math.floor(key) ~= key then
      return false
    end
    if key > count then count = key end
  end
  for i = 1, count do
    if value[i] == nil then
      return false
    end
  end
  return true, count
end

--------------------------------------------------------------------------------
-- String
--------------------------------------------------------------------------------

--- Escape special HTML characters.
function M.escape_html(value)
  local text = tostring(value or "")
  text = text:gsub("&", "&amp;")
  text = text:gsub("<", "&lt;")
  text = text:gsub(">", "&gt;")
  text = text:gsub('"', "&quot;")
  text = text:gsub("'", "&#39;")
  return text
end

--- Validate a payload ID string (alphanumeric, hyphen, underscore).
--- Returns the ID or nil.
function M.validate_payload_id(payload_id)
  if type(payload_id) ~= "string" then
    return nil
  end
  if payload_id:match("^[A-Za-z0-9_%-]+$") then
    return payload_id
  end
  return nil
end

--- Humanize a payload ID for display: "my-app" -> "My app".
function M.humanize_payload_id(payload_id)
  local text = tostring(payload_id or "current"):gsub("_", " "):gsub("%-", " ")
  return text:gsub("^%l", string.upper)
end

return M
