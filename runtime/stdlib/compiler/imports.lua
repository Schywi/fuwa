-- imports.lua
-- Compiler pass for import declarations.
-- Parses "import ... end" blocks and emits local Alias = require("path").
--
-- Refactored pattern: source → tokenize → stream → structured parse → emit.
-- Keeps the existing parse_import_block(ctx, index) / emit_imports(ctx)
-- signatures for compatibility with modules.lua.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")

local M = {}

--------------------------------------------------------------------------------
-- Parse: token stream → structured import data
--------------------------------------------------------------------------------

--- Parse import declarations from a stream positioned at the first import
--- entry (after "import" has been consumed by the caller).
--- Returns an array of {alias, path} entries.
local function parse_imports(s)
  local imports = {}

  while not s:is_done() do
    s:skip_blank_lines()

    local t = s:peek()
    if not t then
      break
    end

    if t.type == "keyword" and t.value == "end" then
      s:next()
      break
    end

    local alias = s:expect("identifier")
    local path = s:expect("string")

    imports[#imports + 1] = {
      alias = alias.value,
      path  = path.value,
    }
  end

  return imports
end

--------------------------------------------------------------------------------
-- Emit: structured import data → Lua source
--------------------------------------------------------------------------------

--- Emit local Alias = require("path") lines into a buffer or ctx.out.
--- Returns the same buffer for chaining.
local function emit_imports_to(imports, buffer_or_ctx)
  for _, item in ipairs(imports) do
    local line = string.format(
      "local %s = require(%s)",
      item.alias,
      strings.quote_lua_string(strings.module_path_to_require_path(item.path))
    )
    if type(buffer_or_ctx.line) == "function" then
      -- Emit buffer
      buffer_or_ctx:line(line)
    else
      -- ctx.out
      buffer_or_ctx.out[#buffer_or_ctx.out + 1] = line
    end
  end
  if #imports > 0 then
    if type(buffer_or_ctx.blank) == "function" then
      buffer_or_ctx:blank()
    else
      buffer_or_ctx.out[#buffer_or_ctx.out + 1] = ""
    end
  end
end

--- Copy every line from an Emit buffer's build() output into ctx.out.
local function emit_buf_to_ctx(out, ctx)
  local text = out:build()
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

--- Collect lines from ctx.lines from 'index' through the matching 'end'.
--- Returns block_lines, end_index (or nil, nil if EOF).
local function collect_block_lines(ctx, index)
  local block_lines = {}
  local i = index
  while i <= #ctx.lines do
    local trimmed = strings.trim(ctx.lines[i])
    if trimmed == "end" then
      return block_lines, i
    end
    block_lines[#block_lines + 1] = ctx.lines[i]
    i = i + 1
  end
  return nil, nil
end

--------------------------------------------------------------------------------
-- Public API (compatible with modules.lua)
--------------------------------------------------------------------------------

--- Parse an import block. Takes ctx and the line index just after "import".
--- Populates ctx.imports and returns the line index after "end".
function M.parse_import_block(ctx, index)
  local block_lines, end_index = collect_block_lines(ctx, index)

  if not end_index then
    diagnostics.add(
      ctx.diagnostics, ctx.filename,
      #ctx.lines > 0 and #ctx.lines or 1,
      "Unexpected EOF while parsing import block",
      ctx.lines[#ctx.lines]
    )
    return #ctx.lines + 1
  end

  -- Tokenize and parse
  local source = table.concat(block_lines, "\n")
  local tokens = tokenizer.tokenize(source)
  local s = Stream.new(tokens, ctx.filename, ctx.diagnostics)
  local imports = parse_imports(s)

  -- Store in ctx for later emission
  ctx.imports = imports

  return end_index + 1
end

--- Emit collected imports into ctx.out. Idempotent (ctx.imports_emitted flag).
--- Uses an Emit buffer internally for clean formatting.
function M.emit_imports(ctx)
  if ctx.imports_emitted then
    return
  end

  local out = Emit.new()
  emit_imports_to(ctx.imports, out)
  emit_buf_to_ctx(out, ctx)

  ctx.imports_emitted = true
end

return M
