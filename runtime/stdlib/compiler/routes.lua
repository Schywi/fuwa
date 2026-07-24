-- routes.lua
-- Compiler pass for routes declarations.
-- Parses "routes do ... end" blocks and emits web.app({...}) Lua output.
--
-- Refactored pattern: source → tokenize → stream → structured parse → emit.
-- Keeps the existing compile_routes_block(ctx, index) signature for
-- compatibility with modules.lua.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")

local M = {}

--------------------------------------------------------------------------------
-- Parse: token stream → structured route data
--------------------------------------------------------------------------------

--- Parse route declarations from a stream positioned at the first route line
--- (after "routes do" has been consumed by the caller).
--- Returns an array of {method, path, handler} entries.
local function parse_routes(s)
  local routes = {}

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

    local method = s:expect("identifier")
    local path = s:expect("string")
    local handler = s:rest_of_line()

    routes[#routes + 1] = {
      method  = method.value,
      path    = path.value,
      handler = handler,
    }
  end

  return routes
end

--------------------------------------------------------------------------------
-- Emit: structured route data → Lua source in an Emit buffer
--------------------------------------------------------------------------------

--- Emit a web.app({...}) block from parsed routes.
local function emit_routes(routes, out)
  out:line('local web = require("runtime.stdlib.web")')
  out:blank()
  out:line("return web.app({")
  out:indent()
  for _, route in ipairs(routes) do
    out:line(
      "web.%s(%s, %s),",
      route.method,
      strings.quote_lua_string(route.path),
      route.handler
    )
  end
  out:dedent()
  out:line("})")
end

--- Copy every line from an Emit buffer's build() output into ctx.out.
local function emit_to_ctx(out, ctx)
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

--------------------------------------------------------------------------------
-- Public API (compatible with modules.lua)
--------------------------------------------------------------------------------

--- Compile a routes block. Takes ctx and the line index just after
--- "routes do". Returns the line index after "end".
--- Internally uses tokenizer/stream for parsing and Emit for codegen.
function M.compile_routes_block(ctx, index)
  local source_lines = ctx.lines

  -- Collect lines belonging to this routes block
  local block_lines = {}
  local i = index
  local end_index = nil
  while i <= #source_lines do
    local trimmed = strings.trim(source_lines[i])
    if trimmed == "end" then
      end_index = i
      break
    end
    block_lines[#block_lines + 1] = source_lines[i]
    i = i + 1
  end

  if not end_index then
    diagnostics.add(
      ctx.diagnostics, ctx.filename,
      #source_lines > 0 and #source_lines or 1,
      "Unexpected EOF while parsing routes block",
      source_lines[#source_lines]
    )
    return #source_lines + 1
  end

  -- Tokenize and parse
  local source = table.concat(block_lines, "\n")
  local tokens = tokenizer.tokenize(source)
  local s = Stream.new(tokens, ctx.filename, ctx.diagnostics)
  local routes = parse_routes(s)

  -- Emit imports first
  imports.emit_imports(ctx)

  -- Emit routes into ctx.out
  local out = Emit.new()
  emit_routes(routes, out)
  emit_to_ctx(out, ctx)

  return end_index + 1
end

return M
