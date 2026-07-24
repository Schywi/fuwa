-- modules.lua
-- Top-level dispatcher for .fuwa module compilation.
-- Iterates source lines, identifies blocks (module, use, import, schema,
-- routes, action) via token detection, and delegates to sub-compilers.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines_mod = require("runtime.stdlib.compiler.lines")
local imports_mod = require("runtime.stdlib.compiler.imports")
local schema = require("runtime.stdlib.compiler.schema")
local routes = require("runtime.stdlib.compiler.routes")
local actions = require("runtime.stdlib.compiler.actions")
local view = require("runtime.stdlib.compiler.view")
local strings = require("runtime.stdlib.compiler.strings")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")

local M = {}

local function new_context(filename, source)
  return {
    filename                  = filename,
    lines                     = lines_mod.split(source),
    out                       = {},
    diagnostics               = {},
    imports                   = {},
    uses                      = {},
    imports_emitted           = false,
    action_bootstrap_emitted  = false,
    has_actions               = false,
    module_name               = nil,
    mode                      = nil,
  }
end

--- Tokenize a line and return the first non-newline token, or nil.
local function first_token(line)
  local tokens = tokenizer.tokenize(line)
  for _, t in ipairs(tokens) do
    if t.type ~= "newline" then
      return t
    end
  end
  return nil
end

--- Tokenize a line and return all non-newline tokens.
local function line_tokens(line)
  local tokens = tokenizer.tokenize(line)
  local out = {}
  for _, t in ipairs(tokens) do
    if t.type ~= "newline" then
      out[#out + 1] = t
    end
  end
  return out
end

local function emit_error(ctx, line_number, message)
  diagnostics.add(ctx.diagnostics, ctx.filename, line_number, message, ctx.lines[line_number])
end

local function compile_module_source(source, filename)
  local ctx = new_context(filename, source)
  local src_lines = ctx.lines

  local i = 1
  while i <= #src_lines do
    local line = src_lines[i]

    if lines_mod.is_blank_or_comment(line) then
      i = i + 1
    else
      local t = first_token(line)

      if not t then
        i = i + 1
      elseif t.type == "keyword" and t.value == "module" then
        local tokens = line_tokens(line)
        if #tokens >= 2 and tokens[2].type == "identifier" then
          ctx.module_name = tokens[2].value
        end
        i = i + 1

      elseif t.type == "keyword" and t.value == "use" then
        local tokens = line_tokens(line)
        if #tokens >= 2 and tokens[2].type == "identifier" then
          local name = tokens[2].value
          if not ctx.uses[name] then
            ctx.uses[name] = true
            ctx.out[#ctx.out + 1] = string.format(
              "local %s = require(%s)", name, strings.quote_lua_string(name))
          end
        end
        i = i + 1

      elseif t.type == "keyword" and t.value == "import" then
        i = imports_mod.parse_import_block(ctx, i + 1)

      elseif t.type == "keyword" and t.value == "schema" then
        -- schema "name" do
        local tokens = line_tokens(line)
        local schema_name = nil
        if #tokens >= 3 and tokens[2].type == "string" and tokens[3].type == "keyword" and tokens[3].value == "do" then
          schema_name = tokens[2].value
        end
        if schema_name then
          if ctx.mode and ctx.mode ~= "schema" then
            emit_error(ctx, i, "Mixed block types are not supported in one file")
            i = i + 1
          else
            ctx.mode = "schema"
            i = schema.compile_schema_block(ctx, i + 1, schema_name)
          end
        else
          emit_error(ctx, i, "Expected: schema \"name\" do")
          i = i + 1
        end

      elseif t.type == "keyword" and t.value == "routes" then
        -- routes do
        if ctx.mode and ctx.mode ~= "routes" then
          emit_error(ctx, i, "Mixed block types are not supported in one file")
          i = i + 1
        else
          ctx.mode = "routes"
          i = routes.compile_routes_block(ctx, i + 1)
        end

      elseif t.type == "keyword" and t.value == "action" then
        -- action name(arg) do
        local tokens = line_tokens(line)
        local action_name, action_arg = nil, nil
        if #tokens >= 6
          and tokens[2].type == "identifier"
          and tokens[3].type == "symbol" and tokens[3].value == "("
          and tokens[4].type == "identifier"
          and tokens[5].type == "symbol" and tokens[5].value == ")"
          and tokens[6].type == "keyword" and tokens[6].value == "do" then
          action_name = tokens[2].value
          action_arg = tokens[4].value
        end
        if action_name then
          if ctx.mode and ctx.mode ~= "action" then
            emit_error(ctx, i, "Mixed block types are not supported in one file")
            i = i + 1
          else
            ctx.mode = "action"
            i = actions.compile_action_block(ctx, i + 1, action_name, action_arg)
          end
        else
          emit_error(ctx, i, "Expected: action name(arg) do")
          i = i + 1
        end

      else
        emit_error(ctx, i, "Unexpected line at top level")
        i = i + 1
      end
    end
  end

  if ctx.has_actions then
    ctx.out[#ctx.out + 1] = "return M"
  end

  if diagnostics.has_errors(ctx.diagnostics) then
    return { lua = nil, diagnostics = ctx.diagnostics }
  end

  return { lua = table.concat(ctx.out, "\n"), diagnostics = ctx.diagnostics }
end

function M.compile_module_source(source, filename)
  return compile_module_source(source, filename)
end

function M.compile_view_source(source, source_files, filename)
  return view.compile_view_module(source, source_files, filename)
end

return M
