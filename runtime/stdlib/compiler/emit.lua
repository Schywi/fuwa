-- emit.lua
-- Output buffer for code generation. Handles indentation, blank lines, and
-- final table.concat. Every compiler codegen pass uses this instead of
-- manual ctx.out[#ctx.out + 1] = ... plus ad-hoc indent tracking.

local M = {}

--- Create a new output buffer.
--- @param indent_str  string  whitespace per indent level (default "  ")
function M.new(indent_str)
  local b = {
    _lines  = {},
    _indent = 0,
    _str    = indent_str or "  ",
  }
  setmetatable(b, { __index = M })
  return b
end

--- Append a formatted line. fmt and args are passed to string.format.
--- The line is prefixed with the current indentation.
function M:line(fmt, ...)
  local text
  if select("#", ...) > 0 then
    text = string.format(fmt, ...)
  else
    text = fmt
  end
  self._lines[#self._lines + 1] = string.rep(self._str, self._indent) .. text
end

--- Append a blank line (no indentation).
function M:blank()
  self._lines[#self._lines + 1] = ""
end

--- Increase indent level by 1.
function M:indent()
  self._indent = self._indent + 1
end

--- Decrease indent level by 1 (clamped to 0).
function M:dedent()
  if self._indent > 0 then
    self._indent = self._indent - 1
  end
end

--- Append raw text without indentation or newline handling.
--- Use for multi-line strings that already contain formatting.
function M:raw(text)
  self._lines[#self._lines + 1] = text
end

--- Join all lines with "\n" and return the complete output string.
function M:build()
  return table.concat(self._lines, "\n")
end

--- Return the number of lines currently in the buffer.
function M:count()
  return #self._lines
end

--- Copy all lines from this buffer into a ctx.out array (the legacy
--- output format used by modules.lua compatibility wrappers).
function M:copy_to_ctx(ctx)
  local text = self:build()
  local pos = 1
  while true do
    local nl = text:find("\n", pos, true)
    if nl then
      ctx.out[#ctx.out + 1] = text:sub(pos, nl - 1)
      pos = nl + 1
    else
      ctx.out[#ctx.out + 1] = text:sub(pos)
      break
    end
  end
end

return M
