-- actions.lua
-- Compiler pass for action declarations.
-- Parses "action name(arg) do ... end" blocks. Handles match/when/else,
-- ?-sugar (Result unwrap), if-> guard, render/redirect/fail desugaring.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines_mod = require("runtime.stdlib.compiler.lines")
local responses = require("runtime.stdlib.compiler.responses")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")
local Emit = require("runtime.stdlib.compiler.emit")
local blocks = require("runtime.stdlib.compiler.block_collector")

local M = {}

--- Emit action preamble: local web/render/redirect/fail, local M = {}.
local function emit_action_preamble(ctx, out)
  if ctx.action_bootstrap_emitted then return end
  imports.emit_imports(ctx)
  out:line('local web = require("runtime.stdlib.web")')
  out:line("local render = web.render")
  out:line("local redirect = web.redirect")
  out:line("local fail = web.fail")
  out:blank()
  out:line("local M = {}")
  out:blank()
  ctx.action_bootstrap_emitted = true
end

--- Emit a match block as if/elseif/else Lua.
local function emit_match_block(out, match_entry)
  for index, wc in ipairs(match_entry.when_clauses) do
    out:line("  %s %s == %s then", index == 1 and "if" or "elseif", match_entry.expr, wc.value)
    out:line("    return %s", responses.apply_response_expr(wc.expr))
  end
  if match_entry.else_expr then
    if #match_entry.when_clauses > 0 then
      out:line("  else")
      out:line("    return %s", responses.apply_response_expr(match_entry.else_expr))
    else
      out:line("  return %s", responses.apply_response_expr(match_entry.else_expr))
    end
  end
  if #match_entry.when_clauses > 0 then out:line("  end") end
end

--- Sugar processing (unchanged from original). Processes:
---   if cond -> result, name = expr?, render/redirect/fail, plain assignment.
local function apply_sugar(line, action_name)
  local trimmed = strings.trim(line)

  local guard_expr, guard_result = trimmed:match("^if%s+(.+)%s*%-%>%s*(.+)$")
  if guard_expr then
    return string.format("if %s then\n  return %s\nend", guard_expr, responses.apply_response_expr(guard_result))
  end

  local slot_name, slot_expr = trimmed:match("^([A-Za-z_][A-Za-z0-9_]*)%s*=%s*(.+)%s*%?$")
  if slot_name and not strings.is_reserved_word(slot_name) then
    local slot = "__r_" .. slot_name
    local expr = strings.trim(slot_expr)
    local lines_out = {
      string.format("local %s = %s", slot, expr),
      string.format("local %s", slot_name),
      string.format("if %s == nil then", slot),
      "  return fail({ kind = \"not_found\", message = \"not found\" }, {",
      string.format("    action = %s,", strings.quote_lua_string(action_name)),
      "    line = 0,",
      string.format("    expr = %s", strings.quote_lua_string(expr)),
      "  })",
      "end",
      string.format("if (type(%s) == \"table\" or type(%s) == \"userdata\") and %s.ok ~= nil then", slot, slot, slot),
      string.format("  if not %s.ok then", slot),
      "    return fail(__ERROR__, {",
      string.format("      action = %s,", strings.quote_lua_string(action_name)),
      "      line = 0,",
      string.format("      expr = %s", strings.quote_lua_string(expr)),
      "    })",
      "  end",
      string.format("  %s = %s.value", slot_name, slot),
      "else",
      string.format("  %s = %s", slot_name, slot),
      "end"
    }
    return (table.concat(lines_out, "\n"):gsub("__ERROR__", slot .. ".err"))
  end

  if strings.starts_with(trimmed, "render ") then
    local rendered = responses.parse_render(trimmed)
    if rendered then return "return " .. rendered end
  end

  if strings.starts_with(trimmed, "redirect ") then
    local redirected = responses.parse_redirect(trimmed)
    if redirected then return "return " .. redirected end
  end

  local plain_name, plain_value = trimmed:match("^([A-Za-z_][A-Za-z0-9_]*)%s*=%s*(.+)$")
  if plain_name and not strings.is_reserved_word(plain_name) then
    return string.format("local %s = %s", plain_name, plain_value)
  end

  return trimmed
end

--- Parse a match block using original line texts for expression capture.
local function parse_match_block(match_expr, match_lines)
  local when_clauses, else_expr = {}, nil
  for _, line in ipairs(match_lines) do
    local t = strings.trim(line)
    if t == "" or t:sub(1, 2) == "--" then
    elseif t == "end" then
      break
    else
      local wv, we = t:match("^when%s+(.+)%s*->%s*(.+)$")
      if wv then
        when_clauses[#when_clauses + 1] = { value = strings.trim(wv), expr = strings.trim(we) }
      else
        local pe = t:match("^else%s*->%s*(.+)$")
        if pe then else_expr = strings.trim(pe) end
      end
    end
  end
  return { expr = match_expr, when_clauses = when_clauses, else_expr = else_expr }
end

--- Emit a body entry (match block or desugared line).
local function emit_body_entry(out, entry)
  if entry.match_entry then
    emit_match_block(out, entry.match_entry)
  else
    local xformed = apply_sugar(entry.line, entry.action_name)
    for part in xformed:gmatch("([^\n]+)") do
      out:line("  %s", part)
    end
  end
end

--- Compile an action block (compatibility wrapper for modules.lua).
function M.compile_action_block(ctx, index, action_name, action_arg)
  ctx.has_actions = true

  local block_lines, end_index = blocks.collect_depth(ctx, index)
  if not end_index then
    diagnostics.add(ctx.diagnostics, ctx.filename, #ctx.lines, "Unexpected EOF while parsing action block")
    return #ctx.lines + 1
  end

  -- Parse body: match blocks get token-based detection, regular lines pass through
  local body = {}
  local i = 1
  while i <= #block_lines do
    local line = strings.trim(block_lines[i])
    if lines_mod.is_blank_or_comment(line) then
      i = i + 1
    else
      local match_expr = line:match("^match%s+(.+)%s+do$")
      if match_expr then
        local match_end = blocks.find_matching_end(block_lines, i + 1)
        if match_end then
          local match_lines = {}
          for j = i + 1, match_end - 1 do match_lines[#match_lines + 1] = block_lines[j] end
          body[#body + 1] = { match_entry = parse_match_block(strings.trim(match_expr), match_lines), action_name = action_name }
          i = match_end + 1
        else
          i = i + 1
        end
      else
        body[#body + 1] = { line = line, action_name = action_name }
        i = i + 1
      end
    end
  end

  -- Emit preamble
  local pout = Emit.new()
  emit_action_preamble(ctx, pout)
  pout:copy_to_ctx(ctx)

  -- Emit function body
  local bout = Emit.new()
  bout:line("function M.%s(%s)", action_name, action_arg)
  for _, entry in ipairs(body) do emit_body_entry(bout, entry) end
  bout:line("end")
  bout:blank()
  bout:copy_to_ctx(ctx)

  return end_index + 1
end

return M
