-- stream.lua
-- Peekable token stream over a token array (produced by tokenizer.lua).
-- Replaces the manual i = i + 1 / while i <= #lines pattern used by every
-- compiler module. Provides expect/maybe for structured parsing and
-- rest_of_line for expression capture.

local M = {}

--- Create a new Stream over a token array.
--- @param tokens   table   array of {type, value, line, col} from tokenizer
--- @param filename string  source filename for error messages
--- @param diag     table   diagnostics accumulator (adds errors to it)
function M.new(tokens, filename, diag)
  local s = {
    _tokens   = tokens,
    _pos      = 1,
    _filename = filename or "unknown",
    _diag     = diag or {},
  }
  setmetatable(s, { __index = M })
  return s
end

--- Peek at the current token without consuming it.
--- Returns nil when the stream is exhausted.
function M:peek()
  if self._pos > #self._tokens then
    return nil
  end
  return self._tokens[self._pos]
end

--- Peek n tokens ahead (0 = current). Returns nil if out of bounds.
function M:peek_ahead(n)
  local idx = self._pos + (n or 0)
  if idx < 1 or idx > #self._tokens then
    return nil
  end
  return self._tokens[idx]
end

--- Consume and return the current token. Returns nil when exhausted.
function M:next()
  local t = self:peek()
  if t then
    self._pos = self._pos + 1
  end
  return t
end

--- True when no more tokens are available.
function M:is_done()
  return self._pos > #self._tokens
end

--- Current 1-based token index.
function M:cursor()
  return self._pos
end

--- Skip blank lines (consecutive newline tokens).
--- Returns the number of blank lines skipped.
function M:skip_blank_lines()
  local count = 0
  while true do
    local t = self:peek()
    if not t or t.type ~= "newline" then
      break
    end
    self:next()
    count = count + 1
  end
  return count
end

--- Assert the current token matches (type, value) and consume it.
--- If value is nil, only type is checked. Adds a diagnostic and returns
--- a placeholder token on mismatch instead of raising an error.
--- @param ttype  string  expected token type
--- @param value  string? optional expected value
--- @return table  the consumed token (or an error placeholder)
function M:expect(ttype, value)
  local t = self:peek()
  if not t then
    self:_error(string.format(
      "Expected %s, got end of input",
      self:_describe(ttype, value)
    ))
    return self:_error_token(ttype)
  end
  if t.type ~= ttype or (value ~= nil and t.value ~= value) then
    self:_error(string.format(
      "Expected %s, got %s %q",
      self:_describe(ttype, value),
      t.type,
      t.value
    ))
    return self:_error_token(ttype)
  end
  return self:next()
end

--- If the current token matches (type, value), consume and return it.
--- Otherwise return nil (no diagnostic added).
function M:maybe(ttype, value)
  local t = self:peek()
  if not t then
    return nil
  end
  if t.type == ttype and (value == nil or t.value == value) then
    return self:next()
  end
  return nil
end

--- Consume all tokens until the next newline (exclusive). The trailing
--- newline is consumed. Token values are concatenated directly (no spaces
--- inserted), which correctly reconstructs dotted paths like Home.index.
--- Callers that need space-separated output should join the token values
--- themselves or use rest_of_line_tokens().
function M:rest_of_line()
  local parts = self:rest_of_line_tokens()
  if not parts then
    return ""
  end
  local words = {}
  for _, tok in ipairs(parts) do
    words[#words + 1] = tok.value
  end
  return table.concat(words)
end

--- Like rest_of_line() but returns the raw token array instead of a
--- joined string. The trailing newline is still consumed.
--- Returns nil if already at end of input.
function M:rest_of_line_tokens()
  if self:is_done() then
    return nil
  end
  local parts = {}
  while true do
    local t = self:peek()
    if not t or t.type == "newline" then
      break
    end
    self:next()
    parts[#parts + 1] = t
  end
  self:next() -- consume the terminating newline
  return parts
end

--- Consume tokens until one of the given stop keywords is seen (type ==
--- "keyword" and value in stop_set). The stop token is NOT consumed.
--- Returns the tokens consumed as an array (or nil if end of input).
function M:until_keyword(stop_set)
  local parts = {}
  while true do
    local t = self:peek()
    if not t then
      return nil
    end
    if t.type == "keyword" and stop_set[t.value] then
      break
    end
    self:next()
    parts[#parts + 1] = t
  end
  return parts
end

--- Current line number (from the token at or before the cursor).
function M:line()
  local t = self:peek()
  if t then
    return t.line
  end
  if #self._tokens > 0 then
    return self._tokens[#self._tokens].line
  end
  return 1
end

--- Current column number.
function M:col()
  local t = self:peek()
  if t then
    return t.col
  end
  return 1
end

--------------------------------------------------------------------------------
-- Internal helpers
--------------------------------------------------------------------------------

function M:_describe(ttype, value)
  if value then
    return string.format("%s %q", ttype, value)
  end
  return ttype
end

function M:_error_token(ttype)
  return { type = ttype, value = "", line = self:line(), col = self:col() }
end

function M:_error(message)
  self._diag[#self._diag + 1] = {
    file    = self._filename,
    line    = self:line(),
    message = message,
  }
end

--- Export the diagnostics accumulator so callers can check has_errors etc.
function M:diagnostics()
  return self._diag
end

return M
