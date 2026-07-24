-- routes.lua
-- Compiler pass for routes declarations.
-- Parses "routes do ... end" blocks and emits web.app({...}) Lua output.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")
local blocks = require("runtime.stdlib.compiler.block_collector")

local M = {}

--- Parse route declarations from a token stream.
--- Returns an array of {method, path, handler} entries.
local function parse_routes(s)
  local routes = {}
  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end
    if t.type == "keyword" and t.value == "end" then s:next(); break end

    local method = s:expect("identifier")
    local path = s:expect("string")
    local handler = s:rest_of_line()
    routes[#routes + 1] = { method = method.value, path = path.value, handler = handler }
  end
  return routes
end

--- Emit a web.app({...}) block.
local function emit_routes(routes, out)
  out:line('local web = require("runtime.stdlib.web")')
  out:blank()
  out:line("return web.app({")
  out:indent()
  for _, r in ipairs(routes) do
    out:line("web.%s(%s, %s),", r.method, strings.quote_lua_string(r.path), r.handler)
  end
  out:dedent()
  out:line("})")
end

--- Compile a routes block (compatibility wrapper for modules.lua).
function M.compile_routes_block(ctx, index)
  local block_lines, end_index = blocks.collect_simple(ctx, index)
  if not end_index then
    diagnostics.add(ctx.diagnostics, ctx.filename, #ctx.lines, "Unexpected EOF while parsing routes block")
    return #ctx.lines + 1
  end

  local tokens = tokenizer.tokenize(table.concat(block_lines, "\n"))
  local s = Stream.new(tokens, ctx.filename, ctx.diagnostics)
  local routes = parse_routes(s)

  imports.emit_imports(ctx)

  local out = Emit.new()
  emit_routes(routes, out)
  out:copy_to_ctx(ctx)

  return end_index + 1
end

return M
