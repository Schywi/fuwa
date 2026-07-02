-- runtime/stdlib/view.lua
-- Tiny SSR template renderer for Fuwa views.
-- It keeps the implementation intentionally small:
-- - recursive HTML parsing
-- - plain table data lookup
-- - a few directive attributes

local M = {}

local void_tags = {
  area = true,
  base = true,
  br = true,
  col = true,
  embed = true,
  hr = true,
  img = true,
  input = true,
  keygen = true,
  link = true,
  meta = true,
  param = true,
  source = true,
  track = true,
  wbr = true,
}

local function trim(s)
  s = s or ""
  return s:match("^%s*(.-)%s*$") or ""
end

local function split_lines(source)
  local lines = {}
  for line in (source .. "\n"):gmatch("([^\n]*)\n") do
    lines[#lines + 1] = line
  end
  return lines
end

local function escape_html(s)
  s = tostring(s or "")
  s = s:gsub("&", "&amp;")
  s = s:gsub("<", "&lt;")
  s = s:gsub(">", "&gt;")
  s = s:gsub('"', "&quot;")
  s = s:gsub("'", "&#39;")
  return s
end

local function make_error(kind, message, ctx, line)
  line = line or ctx.line or 1
  return {
    kind = kind,
    message = message,
    line = line,
    snippet = ctx.lines and ctx.lines[line] or "",
  }
end

local function count_newlines(text)
  local count = 0
  for _ in text:gmatch("\n") do
    count = count + 1
  end
  return count
end

local function advance(ctx, text)
  ctx.line = ctx.line + count_newlines(text)
end

local function find_tag_end(source, pos)
  local quote = nil
  local i = pos + 1
  while i <= #source do
    local ch = source:sub(i, i)
    if quote then
      if ch == quote then
        quote = nil
      end
    else
      if ch == '"' or ch == "'" then
        quote = ch
      elseif ch == ">" then
        return i
      end
    end
    i = i + 1
  end
  return nil
end

local function resolve_path(env, path)
  local current = env
  for part in path:gmatch("[^%.]+") do
    local current_type = type(current)
    if part == "" or (current_type ~= "table" and current_type ~= "userdata") then
      return nil, false
    end

    local next_value = current[part]
    if next_value == nil then
      return nil, false
    end

    current = next_value
  end

  return current, true
end

local function extend_env(env, key, value)
  return setmetatable({ [key] = value }, { __index = env })
end

local function read_token(text, pos)
  local start_pos = pos
  while pos <= #text do
    local ch = text:sub(pos, pos)
    if ch:match("[%w_%.]") then
      pos = pos + 1
    else
      break
    end
  end

  if pos == start_pos then
    return nil, pos
  end

  return text:sub(start_pos, pos - 1), pos
end

local function is_named_entity(text, pos)
  local entity = text:match("^&[%a#][%w#]+;", pos)
  return entity
end

local function render_binding(path, env, opts, ctx, raw, line)
  local value, found = resolve_path(env, path)
  if not found then
    if opts.dev then
      return nil, make_error("missing_binding", "Missing value for binding `" .. path .. "`.", ctx, line)
    end
    return ""
  end

  if raw then
    return tostring(value)
  end

  return escape_html(value)
end

local function scan_bindings(text, env, opts, ctx, line)
  local out = {}
  local i = 1

  while i <= #text do
    local ch = text:sub(i, i)
    if ch ~= "&" then
      local next_amp = text:find("&", i, true) or (#text + 1)
      local literal = text:sub(i, next_amp - 1)
      out[#out + 1] = escape_html(literal)
      i = next_amp
    else
      if text:sub(i, i + 6) == "&unsafe" and text:sub(i + 7, i + 7):match("%s") then
        i = i + 7
        while i <= #text and text:sub(i, i):match("%s") do
          i = i + 1
        end
        local path
        path, i = read_token(text, i)
        if not path then
          return nil, make_error("template_error", "Missing value for `&unsafe` binding.", ctx, line)
        end
        local rendered, err = render_binding(path, env, opts, ctx, true, line)
        if err then
          return nil, err
        end
        out[#out + 1] = rendered
      elseif is_named_entity(text, i) then
        local semicolon = text:find(";", i, true)
        out[#out + 1] = text:sub(i, semicolon)
        i = semicolon + 1
      else
        local path
        path, i = read_token(text, i + 1)
        if not path then
          out[#out + 1] = "&amp;"
          i = i + 1
        else
          local rendered, err = render_binding(path, env, opts, ctx, false, line)
          if err then
            return nil, err
          end
          out[#out + 1] = rendered
        end
      end
    end
  end

  return table.concat(out)
end

local parse_element
local render_node

local function parse_attrs(source)
  local attrs = {}
  local i = 1

  while i <= #source do
    while i <= #source and source:sub(i, i):match("%s") do
      i = i + 1
    end

    if i > #source then
      break
    end

    local ch = source:sub(i, i)
    if ch == "/" then
      break
    end

    local name_start = i
    while i <= #source do
      ch = source:sub(i, i)
      if ch:match("[%s=]") then
        break
      end
      i = i + 1
    end

    local name = source:sub(name_start, i - 1)
    local value = nil

    while i <= #source and source:sub(i, i):match("%s") do
      i = i + 1
    end

    if source:sub(i, i) == "=" then
      i = i + 1
      while i <= #source and source:sub(i, i):match("%s") do
        i = i + 1
      end

      local quote = source:sub(i, i)
      if quote == '"' or quote == "'" then
        i = i + 1
        local value_start = i
        while i <= #source and source:sub(i, i) ~= quote do
          i = i + 1
        end
        value = source:sub(value_start, i - 1)
        if source:sub(i, i) == quote then
          i = i + 1
        end
      else
        local value_start = i
        while i <= #source do
          ch = source:sub(i, i)
          if ch:match("%s") then
            break
          end
          i = i + 1
        end
        value = source:sub(value_start, i - 1)
      end
    end

    attrs[#attrs + 1] = { name = name, value = value }
  end

  return attrs
end

local function parse_nodes(ctx, stop_tag)
  local nodes = {}
  local source = ctx.source

  while ctx.pos <= #source do
    if source:sub(ctx.pos, ctx.pos) == "<" then
      local next_char = source:sub(ctx.pos + 1, ctx.pos + 1)
      if next_char == "/" then
        local close_end = find_tag_end(source, ctx.pos)
        if not close_end then
          return nil, make_error("template_error", "Unclosed closing tag.", ctx, ctx.line)
        end

        local close_chunk = source:sub(ctx.pos, close_end)
        local close_name = close_chunk:match("^</%s*([%w:_-]+)%s*>$")
        if not close_name then
          return nil, make_error("template_error", "Malformed closing tag.", ctx, ctx.line)
        end

        advance(ctx, close_chunk)
        ctx.pos = close_end + 1

        if stop_tag and close_name == stop_tag then
          return nodes
        end

        return nil, make_error(
          "template_error",
          "Unexpected closing tag </" .. close_name .. ">.",
          ctx,
          ctx.line
        )
      elseif next_char:match("[%a!]") then
        local node, err = parse_element(ctx)
        if not node then
          return nil, err
        end
        nodes[#nodes + 1] = node
      else
        local text = "<"
        nodes[#nodes + 1] = { type = "text", text = text, line = ctx.line }
        advance(ctx, text)
        ctx.pos = ctx.pos + 1
      end
    else
      local next_lt = source:find("<", ctx.pos, true) or (#source + 1)
      local text = source:sub(ctx.pos, next_lt - 1)
      nodes[#nodes + 1] = { type = "text", text = text, line = ctx.line }
      advance(ctx, text)
      ctx.pos = next_lt
    end
  end

  if stop_tag then
    return nil, make_error(
      "template_error",
      "Missing closing tag </" .. stop_tag .. ">.",
      ctx,
      ctx.line
    )
  end

  return nodes
end

parse_element = function(ctx)
  local source = ctx.source
  local line = ctx.line
  local tag_end = find_tag_end(source, ctx.pos)
  if not tag_end then
    return nil, make_error("template_error", "Unclosed start tag.", ctx, line)
  end

  local chunk = source:sub(ctx.pos, tag_end)
  local inner = chunk:sub(2, -2)
  local self_closing = false

  if inner:match("/%s*$") then
    self_closing = true
    inner = inner:gsub("%s*/%s*$", "")
  end

  local _, name_end, tag_name = inner:find("^%s*([%w:_-]+)")
  if not tag_name then
    return nil, make_error("template_error", "Malformed start tag.", ctx, line)
  end

  local attrs_raw = inner:sub(name_end + 1)
  local node = {
    type = "element",
    name = tag_name,
    attrs = parse_attrs(attrs_raw),
    children = {},
    line = line,
    self_closing = self_closing or void_tags[tag_name],
  }

  advance(ctx, chunk)
  ctx.pos = tag_end + 1

  if node.self_closing then
    return node
  end

  local children, err = parse_nodes(ctx, tag_name)
  if err then
    return nil, err
  end

  node.children = children
  return node
end

local function render_nodes(nodes, env, opts, ctx)
  local out = {}
  for _, node in ipairs(nodes) do
    local rendered, err = render_node(node, env, opts, ctx)
    if err then
      return nil, err
    end
    out[#out + 1] = rendered
  end
  return table.concat(out)
end

local function parse_if_expr(expr)
  expr = trim(expr)
  local negated = expr:match("^not%s+(.+)$")
  if negated then
    local path = trim(negated)
    if path:match("^[%w_%.]+$") then
      return true, path
    end
    return nil
  end

  if expr:match("^[%w_%.]+$") then
    return false, expr
  end

  return nil
end

local function eval_if_expr(expr, env, opts, ctx, line)
  local negated, path = parse_if_expr(expr)
  if negated == nil then
    return nil, make_error(
      "template_error",
      "Unsupported f-if condition. Expected `path` or `not path`.",
      ctx,
      line
    )
  end

  local value, found = resolve_path(env, path)
  if not found then
    if opts.dev then
      return nil, make_error("missing_binding", "Missing value for binding `" .. path .. "`.", ctx, line)
    end
    value = false
  end

  local ok = not not value
  if negated then
    ok = not ok
  end
  return ok
end

local function parse_for_expr(expr)
  local var, path = expr:match("^%s*([%a_][%w_]*)%s+in%s+(.+)$")
  if not var then
    return nil
  end

  path = trim(path)
  if path == "" then
    return nil
  end

  return var, path
end

local function render_attrs(attrs, env, opts, ctx, line)
  local out = {}
  for _, attr in ipairs(attrs) do
    if attr.name == "f-key" then
      return nil, make_error(
        "template_error",
        "Unsupported f-key. Fuwa SSR templates do not use client-side list keys.",
        ctx,
        line
      )
    end

    if attr.name ~= "f-if" and attr.name ~= "f-for" and attr.name ~= "f-csrf" then
      if attr.value == nil then
        out[#out + 1] = attr.name
      else
        local rendered, err = scan_bindings(attr.value, env, opts, ctx, line)
        if err then
          return nil, err
        end
        out[#out + 1] = attr.name .. '="' .. rendered .. '"'
      end
    end
  end

  return table.concat(out, " ")
end

render_node = function(node, env, opts, ctx)
  if node.type == "text" then
    return scan_bindings(node.text, env, opts, ctx, node.line)
  end

  local if_expr = nil
  local for_expr = nil
  local csrf = false
  local attrs = {}

  for _, attr in ipairs(node.attrs) do
    if attr.name == "f-if" then
      if_expr = attr.value or ""
    elseif attr.name == "f-for" then
      for_expr = attr.value or ""
    elseif attr.name == "f-csrf" then
      csrf = true
    else
      attrs[#attrs + 1] = attr
    end
  end

  if csrf and node.name ~= "form" then
    return nil, make_error("template_error", "f-csrf can only be used on <form>.", ctx, node.line)
  end

  local function render_one(current_env)
    local attr_html, err = render_attrs(attrs, current_env, opts, ctx, node.line)
    if err then
      return nil, err
    end

    local open_tag = "<" .. node.name
    if attr_html ~= "" then
      open_tag = open_tag .. " " .. attr_html
    end
    open_tag = open_tag .. ">"

    if node.self_closing then
      return open_tag
    end

    local children_html, child_err = render_nodes(node.children, current_env, opts, ctx)
    if child_err then
      return nil, child_err
    end

    if csrf then
      local token = opts.csrf or ""
      local hidden = '<input type="hidden" name="_csrf" value="' .. escape_html(token) .. '">'
      children_html = hidden .. children_html
    end

    return open_tag .. children_html .. "</" .. node.name .. ">"
  end

  if for_expr then
    local var, path = parse_for_expr(for_expr)
    if not var then
      return nil, make_error(
        "template_error",
        "Unsupported f-for syntax. Expected `item in items`.",
        ctx,
        node.line
      )
    end

    local list, found = resolve_path(env, path)
    local list_type = type(list)
    if not found or (list_type ~= "table" and list_type ~= "userdata") then
      if opts.dev then
        return nil, make_error(
          "template_error",
          "Unsupported f-for source. Expected a table/list for `" .. path .. "`.",
          ctx,
          node.line
        )
      end
      return ""
    end

    local out = {}
    for _, item in ipairs(list) do
      local item_env = extend_env(env, var, item)
      if if_expr then
        local ok, cond_err = eval_if_expr(if_expr, item_env, opts, ctx, node.line)
        if cond_err then
          return nil, cond_err
        end
        if ok then
          local rendered, err = render_one(item_env)
          if err then
            return nil, err
          end
          out[#out + 1] = rendered
        end
      else
        local rendered, err = render_one(item_env)
        if err then
          return nil, err
        end
        out[#out + 1] = rendered
      end
    end
    return table.concat(out)
  end

  if if_expr then
    local ok, err = eval_if_expr(if_expr, env, opts, ctx, node.line)
    if err then
      return nil, err
    end
    if not ok then
      return ""
    end
  end

  return render_one(env)
end

function M.render(template, data, opts)
  data = data or {}
  opts = opts or {}
  if opts.dev == nil then
    opts.dev = true
  end

  local ctx = {
    source = template or "",
    lines = split_lines(template or ""),
    pos = 1,
    line = 1,
  }

  local nodes, err = parse_nodes(ctx, nil)
  if err then
    return nil, err
  end

  local html, render_err = render_nodes(nodes, data, opts, ctx)
  if render_err then
    return nil, render_err
  end

  return html
end

return M
