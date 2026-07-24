-- imports.lua
-- Compiler pass for import declarations.
-- Parses "import ... end" blocks and emits local Alias = require("path").

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")
local blocks = require("runtime.stdlib.compiler.block_collector")

local M = {}

--- Parse import entries from a token stream.
--- Returns an array of {alias, path} entries.
local function parse_imports(s)
  local imports = {}
  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end
    if t.type == "keyword" and t.value == "end" then s:next(); break end

    local alias = s:expect("identifier")
    local path = s:expect("string")
    imports[#imports + 1] = { alias = alias.value, path = path.value }
  end
  return imports
end

--- Emit local Alias = require("path") lines into an Emit buffer.
local function emit_imports_to(imports, out)
  for _, item in ipairs(imports) do
    out:line("local %s = require(%s)", item.alias,
      strings.quote_lua_string(strings.module_path_to_require_path(item.path)))
  end
  if #imports > 0 then out:blank() end
end

--- Parse an import block (compatibility wrapper for modules.lua).
function M.parse_import_block(ctx, index)
  local block_lines, end_index = blocks.collect_simple(ctx, index)
  if not end_index then
    diagnostics.add(ctx.diagnostics, ctx.filename, #ctx.lines, "Unexpected EOF while parsing import block")
    return #ctx.lines + 1
  end

  local tokens = tokenizer.tokenize(table.concat(block_lines, "\n"))
  local s = Stream.new(tokens, ctx.filename, ctx.diagnostics)
  ctx.imports = parse_imports(s)

  return end_index + 1
end

--- Emit collected imports into ctx.out. Idempotent.
function M.emit_imports(ctx)
  if ctx.imports_emitted then return end

  local out = Emit.new()
  emit_imports_to(ctx.imports, out)
  out:copy_to_ctx(ctx)

  ctx.imports_emitted = true
end

return M
