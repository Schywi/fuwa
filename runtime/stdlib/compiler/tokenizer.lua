-- tokenizer.lua
-- Lexer for the .fuwa language. Takes a source string, returns a flat array
-- of {type, value, line, col} tokens. Comments (-- to EOL) are skipped.
-- Whitespace other than newlines is skipped. Newlines are emitted as
-- significant tokens so line-oriented parsers can use rest_of_line().

local M = {}

local keywords = {
  ["module"]     = true,
  ["use"]        = true,
  ["import"]     = true,
  ["schema"]     = true,
  ["routes"]     = true,
  ["action"]     = true,
  ["do"]         = true,
  ["end"]        = true,
  ["field"]      = true,
  ["change"]     = true,
  ["accept"]     = true,
  ["require"]    = true,
  ["timestamps"] = true,
  ["match"]      = true,
  ["when"]       = true,
  ["else"]       = true,
  ["if"]         = true,
  ["render"]     = true,
  ["redirect"]   = true,
  ["fail"]       = true,
  ["return"]     = true,
  ["true"]       = true,
  ["false"]      = true,
  ["and"]        = true,
  ["or"]         = true,
  ["not"]        = true,
  ["for"]        = true,
  ["in"]         = true,
  ["function"]   = true,
  ["local"]      = true,
  ["nil"]        = true,
}

local multi_char_symbols = {
  ["->"] = true,
  ["=="] = true,
  ["!="] = true,
  ["<="] = true,
  [">="] = true,
}

local function is_digit(c)
  return c >= "0" and c <= "9"
end

local function is_alpha(c)
  return (c >= "a" and c <= "z") or (c >= "A" and c <= "Z") or c == "_"
end

local function is_alphanumeric(c)
  return is_alpha(c) or is_digit(c)
end

local function is_symbol_char(c)
  return c == ":" or c == "!"
    or c == "(" or c == ")" or c == "{" or c == "}" or c == "[" or c == "]"
    or c == "," or c == "." or c == "?"
    or c == "=" or c == "+" or c == "-"
    or c == "*" or c == "/" or c == "%"
    or c == "^" or c == "<" or c == ">"
    or c == "#"
end

local function make_token(t, value, line, col)
  return { type = t, value = value, line = line, col = col }
end

--- Tokenize a .fuwa source string.
--- Returns an array of tokens. Each token is { type, value, line, col }.
function M.tokenize(source)
  local tokens = {}
  local s = tostring(source or "")
  local i = 1
  local n = #s
  local line = 1
  local col = 1

  while i <= n do
    local c = s:sub(i, i)

    if c == " " or c == "\t" then
      col = col + 1
      i = i + 1

    elseif c == "\r" then
      if i + 1 <= n and s:sub(i + 1, i + 1) == "\n" then
        i = i + 1
      end
      tokens[#tokens + 1] = make_token("newline", "\n", line, col)
      line = line + 1
      col = 1
      i = i + 1

    elseif c == "\n" then
      tokens[#tokens + 1] = make_token("newline", "\n", line, col)
      line = line + 1
      col = 1
      i = i + 1

    elseif c == "-" and i + 1 <= n and s:sub(i + 1, i + 1) == "-" then
      i = i + 2
      while i <= n do
        local ch = s:sub(i, i)
        if ch == "\n" or ch == "\r" then
          break
        end
        i = i + 1
      end

    elseif c == '"' then
      local start_col = col
      local buf = {}
      i = i + 1
      col = col + 1
      while i <= n do
        local ch = s:sub(i, i)
        if ch == '"' then
          i = i + 1
          col = col + 1
          break
        elseif ch == "\\" and i + 1 <= n then
          local esc = s:sub(i + 1, i + 1)
          if esc == '"' then
            buf[#buf + 1] = '"'
          elseif esc == "\\" then
            buf[#buf + 1] = "\\"
          elseif esc == "n" then
            buf[#buf + 1] = "\n"
          elseif esc == "t" then
            buf[#buf + 1] = "\t"
          else
            buf[#buf + 1] = ch .. esc
          end
          i = i + 2
          col = col + 2
        elseif ch == "\n" or ch == "\r" then
          break
        else
          buf[#buf + 1] = ch
          i = i + 1
          col = col + 1
        end
      end
      tokens[#tokens + 1] = make_token("string", table.concat(buf), line, start_col)

    elseif is_digit(c) then
      local start_col = col
      local buf = { c }
      i = i + 1
      col = col + 1
      while i <= n and is_digit(s:sub(i, i)) do
        buf[#buf + 1] = s:sub(i, i)
        i = i + 1
        col = col + 1
      end
      if i <= n and s:sub(i, i) == "." and i + 1 <= n and is_digit(s:sub(i + 1, i + 1)) then
        buf[#buf + 1] = "."
        i = i + 1
        col = col + 1
        while i <= n and is_digit(s:sub(i, i)) do
          buf[#buf + 1] = s:sub(i, i)
          i = i + 1
          col = col + 1
        end
      end
      tokens[#tokens + 1] = make_token("number", table.concat(buf), line, start_col)

    elseif is_alpha(c) then
      local start_col = col
      local buf = { c }
      i = i + 1
      col = col + 1
      while i <= n and is_alphanumeric(s:sub(i, i)) do
        buf[#buf + 1] = s:sub(i, i)
        i = i + 1
        col = col + 1
      end
      local word = table.concat(buf)
      if keywords[word] then
        tokens[#tokens + 1] = make_token("keyword", word, line, start_col)
      else
        tokens[#tokens + 1] = make_token("identifier", word, line, start_col)
      end

    elseif is_symbol_char(c) then
      local start_col = col
      local two = s:sub(i, i + 1)
      if multi_char_symbols[two] then
        tokens[#tokens + 1] = make_token("symbol", two, line, start_col)
        i = i + 2
        col = col + 2
      else
        tokens[#tokens + 1] = make_token("symbol", c, line, start_col)
        i = i + 1
        col = col + 1
      end

    else
      tokens[#tokens + 1] = make_token("symbol", c, line, col)
      i = i + 1
      col = col + 1
    end
  end

  -- Trailing newline ensures line-oriented parsers always have a terminator.
  if #tokens == 0 or tokens[#tokens].type ~= "newline" then
    tokens[#tokens + 1] = make_token("newline", "\n", line, col)
  end

  return tokens
end

--- Return a human-readable representation of a token array (for debugging).
function M.dump(tokens)
  local lines = {}
  for _, t in ipairs(tokens) do
    lines[#lines + 1] = string.format(
      "  [%d:%d] %-10s %s",
      t.line, t.col, t.type, t.value
    )
  end
  return table.concat(lines, "\n")
end

return M
