-- actions.lua
-- Compiler pass for action declarations.
-- Parses "action name(arg) do ... end" blocks. Handles match/when/else,
-- ?-sugar (Result unwrap), if-> guard, render/redirect/fail desugaring.
--
-- Refactored: match blocks use tokenizer/stream. Emit uses Emit buffer.
-- apply_sugar keeps its string-based approach (it processes reconstructed
-- source text). External compile_action_block(ctx, index, ...) preserved.

local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local lines = require("runtime.stdlib.compiler.lines")
local responses = require("runtime.stdlib.compiler.responses")
local strings = require("runtime.stdlib.compiler.strings")
local imports = require("runtime.stdlib.compiler.imports")
local tokenizer = require("runtime.stdlib.compiler.tokenizer")
local Stream = require("runtime.stdlib.compiler.stream")
local Emit = require("runtime.stdlib.compiler.emit")

local M = {}

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

--- Collect source lines with depth-aware do/end tracking (match blocks
--- inside actions are nested).
local function collect_block_lines_depth(ctx, index)
  local block_lines = {}
  local depth = 0
  local i = index
  while i <= #ctx.lines do
    local trimmed = strings.trim(ctx.lines[i])
    if trimmed:match(" do$") then
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

--- Reconstruct source text from tokens, inserting spaces between word-type
--- tokens (identifiers, keywords, strings, numbers) and no spaces around
--- symbols. String tokens are re-quoted.
local function tokens_to_source_smart(tokens)
  if #tokens == 0 then return "" end
  local word_types = { identifier = true, keyword = true, string = true, number = true }

  local function token_text(tok)
    if tok.type == "string" then
      return '"' .. tok.value .. '"'
    end
    return tok.value
  end

  local parts = { token_text(tokens[1]) }
  for i = 2, #tokens do
    local prev = tokens[i - 1]
    local curr = tokens[i]
    if word_types[prev.type] and word_types[curr.type] then
      parts[#parts + 1] = " "
    end
    parts[#parts + 1] = token_text(curr)
  end
  return table.concat(parts)
end

--- Find the matching "end" for a nested block within block_lines.
--- Returns the line index of the matching end, or nil.
local function find_matching_end(block_lines, start_index)
  local depth = 0
  local j = start_index
  while j <= #block_lines do
    local ml = strings.trim(block_lines[j])
    if ml:match(" do$") then
      depth = depth + 1
    elseif ml == "end" then
      if depth == 0 then
        return j
      end
      depth = depth - 1
    end
    j = j + 1
  end
  return nil
end

--------------------------------------------------------------------------------
-- Emit: action preamble + body
--------------------------------------------------------------------------------

--- Emit action bootstrap: local web/render/redirect/fail, local M = {}.
local function emit_action_preamble(ctx, out)
  if ctx.action_bootstrap_emitted then
    return
  end
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

--- Emit a match block as if/elseif/else Lua in an Emit buffer.
local function emit_match_block(out, match_entry)
  for index, when_clause in ipairs(match_entry.when_clauses) do
    local prefix = index == 1 and "if" or "elseif"
    out:line("  %s %s == %s then", prefix, match_entry.expr, when_clause.value)
    out:line("    return %s", responses.apply_response_expr(when_clause.expr))
  end

  if match_entry.else_expr then
    if #match_entry.when_clauses > 0 then
      out:line("  else")
      out:line("    return %s", responses.apply_response_expr(match_entry.else_expr))
    else
      out:line("  return %s", responses.apply_response_expr(match_entry.else_expr))
    end
  end

  if #match_entry.when_clauses > 0 then
    out:line("  end")
  end
end

--- Emit a single action body entry into an Emit buffer.
-- NOTE: apply_sugar is defined below (Lua local functions aren't hoisted).
local function emit_body_entry(out, body_entry, apply_sugar_fn)
  if body_entry.match_entry then
    emit_match_block(out, body_entry.match_entry)
  else
    local transformed = apply_sugar_fn(body_entry.line, body_entry.action_name)
    for part in transformed:gmatch("([^\n]+)") do
      out:line("  %s", part)
    end
  end
end

--------------------------------------------------------------------------------
-- Sugar processing
-- Kept as string-based (original logic). Processes:
--   if cond -> result       (guard)
--   name = expr?            (Result unwrap)
--   render "view", key: v   (render)
--   redirect "path"         (redirect)
--   name = value            (plain assignment)
--------------------------------------------------------------------------------

local function apply_sugar(line, action_name)
  local trimmed = strings.trim(line)

  -- if guard:  if condition -> result
  local guard_expr, guard_result = trimmed:match("^if%s+(.+)%s*%-%>%s*(.+)$")
  if guard_expr then
    return string.format("if %s then\n  return %s\nend",
      guard_expr, responses.apply_response_expr(guard_result))
  end

  -- Result unwrap:  name = expr?
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
      string.format("if (type(%s) == \"table\" or type(%s) == \"userdata\") and %s.ok ~= nil then",
        slot, slot, slot),
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

  -- render "view", key: value
  if strings.starts_with(trimmed, "render ") then
    local rendered = responses.parse_render(trimmed)
    if rendered then
      return "return " .. rendered
    end
  end

  -- redirect "path"
  if strings.starts_with(trimmed, "redirect ") then
    local redirected = responses.parse_redirect(trimmed)
    if redirected then
      return "return " .. redirected
    end
  end

  -- Plain assignment:  name = value
  local plain_name, plain_value = trimmed:match("^([A-Za-z_][A-Za-z0-9_]*)%s*=%s*(.+)$")
  if plain_name and not strings.is_reserved_word(plain_name) then
    return string.format("local %s = %s", plain_name, plain_value)
  end

  return trimmed
end

--------------------------------------------------------------------------------
-- Parse: token stream -> structured match block
--------------------------------------------------------------------------------

--- Parse a match block using the token stream for structure detection
--- but original line texts for expression capture (avoids fragile token
--- reconstruction). match_lines are the original text lines of the match body.
local function parse_match_block(s, match_expr, match_lines)
  local when_clauses = {}
  local else_expr = nil

  for _, line in ipairs(match_lines) do
    local trimmed = strings.trim(line)
    if trimmed == "" or trimmed:sub(1, 2) == "--" then
      -- skip blank/comment lines
    elseif trimmed == "end" then
      break
    else
      local when_value, when_expr = trimmed:match("^when%s+(.+)%s*->%s*(.+)$")
      if when_value then
        when_clauses[#when_clauses + 1] = {
          value = strings.trim(when_value),
          expr  = strings.trim(when_expr),
        }
      else
        local parsed_else = trimmed:match("^else%s*->%s*(.+)$")
        if parsed_else then
          else_expr = strings.trim(parsed_else)
        end
      end
    end
  end

  return {
    expr         = match_expr,
    when_clauses = when_clauses,
    else_expr    = else_expr,
  }
end

--------------------------------------------------------------------------------
-- Public API (compatible with modules.lua)
--------------------------------------------------------------------------------

--- Compile an action block. Takes ctx, the line index just after
--- "action name(arg) do", the action name, and the arg name.
--- Returns the line index after "end".
function M.compile_action_block(ctx, index, action_name, action_arg)
  ctx.has_actions = true

  local block_lines, end_index = collect_block_lines_depth(ctx, index)

  if not end_index then
    diagnostics.add(
      ctx.diagnostics, ctx.filename,
      #ctx.lines > 0 and #ctx.lines or 1,
      "Unexpected EOF while parsing action block",
      ctx.lines[#ctx.lines]
    )
    return #ctx.lines + 1
  end

  -- Parse body: line-by-line dispatch, token-stream for match blocks
  local body = {}
  local i = 1
  while i <= #block_lines do
    local line = strings.trim(block_lines[i])
    if lines.is_blank_or_comment(line) then
      i = i + 1
    else
      local match_expr = line:match("^match%s+(.+)%s+do$")
      if match_expr then
        local match_end = find_matching_end(block_lines, i + 1)
        if match_end then
          -- Collect match body lines and tokenize them
          local match_lines = {}
          for j = i + 1, match_end - 1 do
            match_lines[#match_lines + 1] = block_lines[j]
          end
          local match_entry = parse_match_block(nil, strings.trim(match_expr), match_lines)

          body[#body + 1] = {
            match_entry = match_entry,
            action_name = action_name,
          }
          i = match_end + 1
        else
          i = i + 1
        end
      else
        -- Regular body line: pass to sugar processing
        body[#body + 1] = {
          line        = line,
          action_name = action_name,
        }
        i = i + 1
      end
    end
  end

  -- Emit preamble
  local preamble_out = Emit.new()
  emit_action_preamble(ctx, preamble_out)
  emit_buf_to_ctx(preamble_out, ctx)

  -- Emit function body
  local body_out = Emit.new()
  body_out:line("function M.%s(%s)", action_name, action_arg)
  for _, entry in ipairs(body) do
    emit_body_entry(body_out, entry, apply_sugar)
  end
  body_out:line("end")
  body_out:blank()
  emit_buf_to_ctx(body_out, ctx)

  return end_index + 1
end

return M
