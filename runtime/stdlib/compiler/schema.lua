-- schema.lua
-- Compiler pass for schema declarations.
-- Parses "schema \"table\" do ... end" blocks and emits schema.model(...).
--
-- Refactored pattern: source → tokenize → stream → structured parse → emit.
-- Keeps the existing compile_schema_block(ctx, index, table_name) signature.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")

local M = {}

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

--- Parse field flags from a list of tokens (the "rest of line" after the
--- field type). Flags are: required, unique, redact, default VALUE.
local function parse_field_flags(tokens)
  local flags = {}
  local i = 1
  while i <= #tokens do
    local t = tokens[i]
    if t.value == "required" then
      flags.required = true
      i = i + 1
    elseif t.value == "unique" then
      flags.unique = true
      i = i + 1
    elseif t.value == "redact" then
      flags.redact = true
      i = i + 1
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

--- Consume remaining tokens on the current line (until newline) and return
--- them as an array. The trailing newline is consumed.
local function consume_line_tokens(s)
  local parts = {}
  while true do
    local t = s:peek()
    if not t or t.type == "newline" then
      break
    end
    s:next()
    parts[#parts + 1] = t
  end
  s:next() -- consume the terminating newline
  return parts
end

--- Parse comma-separated identifiers from tokens. Handles "key, count, active".
local function parse_comma_separated(tokens)
  local values = {}
  for _, t in ipairs(tokens) do
    if t.type ~= "symbol" or t.value ~= "," then
      values[#values + 1] = t.value
    end
  end
  return values
end

--- Collect source lines from ctx.lines from 'index' through the matching
--- 'end' keyword, respecting nested do/end blocks (depth-aware).
--- Returns block_lines, end_index (or nil, nil if EOF).
local function collect_block_lines(ctx, index)
  local block_lines = {}
  local depth = 0
  local i = index
  while i <= #ctx.lines do
    local trimmed = strings.trim(ctx.lines[i])
    if trimmed:match("^%a+ do$") or trimmed:match("^change %a+ do$") then
      depth = depth + 1
    elseif trimmed == "end" then
      if depth == 0 then
        return block_lines, i
      end
      depth = depth - 1
    end
    block_lines[#block_lines + 1] = ctx.lines[i]
    i = i + 1
  end
  return nil, nil
end

--- Copy every line from an Emit buffer into ctx.out.
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

--------------------------------------------------------------------------------
-- Parse: token stream → structured schema data
--------------------------------------------------------------------------------

--- Parse schema body from a stream positioned at the first line inside
--- "schema ... do". Returns { name, table_name, fields, changes, has_timestamps }.
local function parse_schema_body(s, schema_name, table_name)
  local fields = {}
  local changes = {}
  local has_timestamps = false

  while not s:is_done() do
    s:skip_blank_lines()

    local t = s:peek()
    if not t then break end

    if t.type == "keyword" and t.value == "end" then
      s:next()
      break
    elseif t.type == "keyword" and t.value == "timestamps" then
      s:next()
      s:skip_blank_lines()
      -- consume any trailing newline after timestamps
      if s:peek() and s:peek().type == "newline" then
        s:next()
      end
      has_timestamps = true
    elseif t.type == "keyword" and t.value == "field" then
      s:next() -- consume "field"
      local fname = s:expect("identifier")
      s:expect("symbol", ":")
      local ftype = s:expect("identifier")
      local flag_tokens = consume_line_tokens(s)
      fields[#fields + 1] = {
        name  = fname.value,
        type  = ftype.value,
        flags = parse_field_flags(flag_tokens),
      }
    elseif t.type == "keyword" and t.value == "change" then
      s:next()
      local change_name = s:expect("identifier")
      s:expect("keyword", "do")

      -- Parse change body: accept/require lines until end
      local accept = {}
      local required_fields = {}
      while not s:is_done() do
        s:skip_blank_lines()
        local ct = s:peek()
        if not ct then break end
        if ct.type == "keyword" and ct.value == "end" then
          s:next()
          break
        elseif ct.type == "keyword" and ct.value == "accept" then
          s:next()
          local acc_tokens = consume_line_tokens(s)
          accept = parse_comma_separated(acc_tokens)
        elseif ct.type == "keyword" and ct.value == "require" then
          s:next()
          local req_tokens = consume_line_tokens(s)
          required_fields = parse_comma_separated(req_tokens)
        else
          -- unexpected token, skip line
          s:rest_of_line()
        end
      end

      changes[#changes + 1] = {
        name    = change_name.value,
        accept  = accept,
        require = required_fields,
      }
    else
      -- unexpected token: report error and consume rest of line
      s:_error("Expected: field name: type [flags], timestamps, change do, or end")
      s:rest_of_line()
    end
  end

  return {
    name           = schema_name,
    table_name     = table_name,
    fields         = fields,
    changes        = changes,
    has_timestamps = has_timestamps,
  }
end

--------------------------------------------------------------------------------
-- Emit: structured schema data → Lua source
--------------------------------------------------------------------------------

--- Emit a schema.model(...) block into an Emit buffer.
local function emit_schema(node, out)
  out:line('local schema = require("runtime.stdlib.schema")')
  out:blank()
  out:line(
    "return schema.model(%s, %s, {",
    strings.quote_lua_string(node.name),
    strings.quote_lua_string(node.table_name)
  )
  out:indent()

  for _, field in ipairs(node.fields) do
    local flag_parts = {}
    if field.flags.required then
      flag_parts[#flag_parts + 1] = "required = true"
    end
    if field.flags.unique then
      flag_parts[#flag_parts + 1] = "unique = true"
    end
    if field.flags.redact then
      flag_parts[#flag_parts + 1] = "redact = true"
    end
    if field.flags.default ~= nil then
      flag_parts[#flag_parts + 1] = "default = " .. strings.format_default_value(field.flags.default)
    end

    local flags_str
    if #flag_parts > 0 then
      flags_str = "{ " .. table.concat(flag_parts, ", ") .. " }"
    else
      flags_str = "{}"
    end

    out:line(
      "schema.field(%s, %s, %s),",
      strings.quote_lua_string(field.name),
      strings.quote_lua_string(field.type),
      flags_str
    )
  end

  for _, change in ipairs(node.changes) do
    out:line("schema.change(%s, {", strings.quote_lua_string(change.name))
    out:indent()

    -- accept list
    local accept_parts = {}
    for _, v in ipairs(change.accept) do
      accept_parts[#accept_parts + 1] = strings.quote_lua_string(v)
    end
    out:line("accept = { %s },", table.concat(accept_parts, ", "))

    -- require list
    local require_parts = {}
    for _, v in ipairs(change.require) do
      require_parts[#require_parts + 1] = strings.quote_lua_string(v)
    end
    out:line("require = { %s },", table.concat(require_parts, ", "))

    out:dedent()
    out:line("}),")
  end

  if node.has_timestamps then
    out:line("schema.timestamps(),")
  end

  out:dedent()
  out:line("})")
end

--------------------------------------------------------------------------------
-- Public API (compatible with modules.lua)
--------------------------------------------------------------------------------

--- Compile a schema block. Takes ctx, the line index just after "schema ... do",
--- and the table name. Returns the line index after "end".
function M.compile_schema_block(ctx, index, table_name)
  local block_lines, end_index = collect_block_lines(ctx, index)

  if not end_index then
    diagnostics.add(
      ctx.diagnostics, ctx.filename,
      #ctx.lines > 0 and #ctx.lines or 1,
      "Unexpected EOF while parsing schema block",
      ctx.lines[#ctx.lines]
    )
    return #ctx.lines + 1
  end

  local schema_name = ctx.module_name or table_name

  -- Tokenize and parse
  local source = table.concat(block_lines, "\n")
  local tokens = tokenizer.tokenize(source)
  local s = Stream.new(tokens, ctx.filename, ctx.diagnostics)
  local node = parse_schema_body(s, schema_name, table_name)

  -- Emit imports first, then schema
  imports.emit_imports(ctx)

  local out = Emit.new()
  emit_schema(node, out)
  emit_buf_to_ctx(out, ctx)

  return end_index + 1
end

return M
