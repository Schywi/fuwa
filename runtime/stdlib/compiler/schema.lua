-- schema.lua
-- Compiler pass for schema declarations.
-- Parses "schema \"table\" do ... end" blocks and emits schema.model(...).

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")
local blocks = require("runtime.stdlib.compiler.block_collector")

local M = {}

--- Parse field flags from a token array (rest-of-line after field type).
--- Flags: required, unique, redact, default VALUE.
local function parse_field_flags(tokens)
  local flags = {}
  local i = 1
  while i <= #tokens do
    local t = tokens[i]
    if t.value == "required" then
      flags.required = true; i = i + 1
    elseif t.value == "unique" then
      flags.unique = true; i = i + 1
    elseif t.value == "redact" then
      flags.redact = true; i = i + 1
    elseif t.value == "default" then
      i = i + 1
      if i <= #tokens then
        flags.default = strings.parse_default_value(tokens[i].value)
        i = i + 1
      end
    else
      i = i + 1
    end
  end
  return flags
end

--- Parse comma-separated identifiers from tokens. Filters out comma symbols.
local function parse_comma_separated(tokens)
  local values = {}
  for _, t in ipairs(tokens) do
    if t.type ~= "symbol" or t.value ~= "," then
      values[#values + 1] = t.value
    end
  end
  return values
end

--- Parse schema body from a token stream. Returns structured node.
local function parse_schema_body(s, schema_name, table_name)
  local fields, changes = {}, {}
  local has_timestamps = false

  while not s:is_done() do
    s:skip_blank_lines()
    local t = s:peek()
    if not t then break end

    if t.type == "keyword" and t.value == "end" then
      s:next(); break
    elseif t.type == "keyword" and t.value == "timestamps" then
      s:next()
      s:skip_blank_lines()
      if s:peek() and s:peek().type == "newline" then s:next() end
      has_timestamps = true
    elseif t.type == "keyword" and t.value == "field" then
      s:next()
      local fname = s:expect("identifier")
      s:expect("symbol", ":")
      local ftype = s:expect("identifier")
      local flag_tokens = s:rest_of_line_tokens() or {}
      fields[#fields + 1] = {
        name  = fname.value,
        type  = ftype.value,
        flags = parse_field_flags(flag_tokens),
      }
    elseif t.type == "keyword" and t.value == "change" then
      s:next()
      local change_name = s:expect("identifier")
      s:expect("keyword", "do")

      local accept, required_fields = {}, {}
      while not s:is_done() do
        s:skip_blank_lines()
        local ct = s:peek()
        if not ct then break end
        if ct.type == "keyword" and ct.value == "end" then s:next(); break
        elseif ct.type == "keyword" and ct.value == "accept" then
          s:next()
          accept = parse_comma_separated(s:rest_of_line_tokens() or {})
        elseif ct.type == "keyword" and ct.value == "require" then
          s:next()
          required_fields = parse_comma_separated(s:rest_of_line_tokens() or {})
        else
          s:rest_of_line()
        end
      end

      changes[#changes + 1] = { name = change_name.value, accept = accept, require = required_fields }
    else
      s:_error("Expected: field name: type [flags], timestamps, change do, or end")
      s:rest_of_line()
    end
  end

  return { name = schema_name, table_name = table_name, fields = fields, changes = changes, has_timestamps = has_timestamps }
end

--- Emit a schema.model(...) block.
local function emit_schema(node, out)
  out:line('local schema = require("runtime.stdlib.schema")')
  out:blank()
  out:line("return schema.model(%s, %s, {", strings.quote_lua_string(node.name), strings.quote_lua_string(node.table_name))
  out:indent()

  for _, f in ipairs(node.fields) do
    local parts = {}
    if f.flags.required then parts[#parts + 1] = "required = true" end
    if f.flags.unique   then parts[#parts + 1] = "unique = true" end
    if f.flags.redact   then parts[#parts + 1] = "redact = true" end
    if f.flags.default ~= nil then parts[#parts + 1] = "default = " .. strings.format_default_value(f.flags.default) end
    local fs = #parts > 0 and "{ " .. table.concat(parts, ", ") .. " }" or "{}"
    out:line("schema.field(%s, %s, %s),", strings.quote_lua_string(f.name), strings.quote_lua_string(f.type), fs)
  end

  for _, c in ipairs(node.changes) do
    out:line("schema.change(%s, {", strings.quote_lua_string(c.name))
    out:indent()
    local acc = {}
    for _, v in ipairs(c.accept) do acc[#acc + 1] = strings.quote_lua_string(v) end
    out:line("accept = { %s },", table.concat(acc, ", "))
    local req = {}
    for _, v in ipairs(c.require) do req[#req + 1] = strings.quote_lua_string(v) end
    out:line("require = { %s },", table.concat(req, ", "))
    out:dedent()
    out:line("}),")
  end

  if node.has_timestamps then out:line("schema.timestamps(),") end

  out:dedent()
  out:line("})")
end

--- Compile a schema block (compatibility wrapper for modules.lua).
function M.compile_schema_block(ctx, index, table_name)
  local block_lines, end_index = blocks.collect_depth(ctx, index)
  if not end_index then
    diagnostics.add(ctx.diagnostics, ctx.filename, #ctx.lines, "Unexpected EOF while parsing schema block")
    return #ctx.lines + 1
  end

  local tokens = tokenizer.tokenize(table.concat(block_lines, "\n"))
  local s = Stream.new(tokens, ctx.filename, ctx.diagnostics)
  local node = parse_schema_body(s, ctx.module_name or table_name, table_name)

  imports.emit_imports(ctx)

  local out = Emit.new()
  emit_schema(node, out)
  out:copy_to_ctx(ctx)

  return end_index + 1
end

return M
