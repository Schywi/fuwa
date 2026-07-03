-- runtime/stdlib/web.lua
-- Tiny web runtime. No middleware. No classes. Plain functions.

local M = {}

local function url_decode(value)
  value = tostring(value or "")
  value = value:gsub("+", " ")
  value = value:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end)
  return value
end

-- ── response helpers (imported by compiled action modules) ───────────────────

function M.render(view, data)
  return { _type = "render", view = view, data = data or {} }
end

function M.redirect(path)
  return { _type = "redirect", path = path }
end

function M.fail(err, meta)
  meta = meta or {}
  return {
    _type = "error",
    err = err,
    action = meta.action,
    line = meta.line,
    expr = meta.expr,
  }
end

-- ── route constructors ───────────────────────────────────────────────────────

local function route(method, path, handler)
  return { method = method, path = path, handler = handler }
end

function M.GET(path, handler)
  return route("GET", path, handler)
end

function M.POST(path, handler)
  return route("POST", path, handler)
end

function M.PUT(path, handler)
  return route("PUT", path, handler)
end

function M.DELETE(path, handler)
  return route("DELETE", path, handler)
end

function M.PATCH(path, handler)
  return route("PATCH", path, handler)
end

-- ── simple path matching ─────────────────────────────────────────────────────
-- Supports exact paths and :param segments.
-- "/users/:id" matches "/users/42" -> params = { id = "42" }

local function match_path(pattern, actual)
  local params = {}
  local pat_parts = {}
  for part in (pattern .. "/"):gmatch("([^/]*)/") do
    pat_parts[#pat_parts + 1] = part
  end

  local act_parts = {}
  for part in (actual .. "/"):gmatch("([^/]*)/") do
    act_parts[#act_parts + 1] = part
  end

  if #pat_parts ~= #act_parts then
    return false, nil
  end

  for idx, part in ipairs(pat_parts) do
    local actual_part = act_parts[idx]
    if part:sub(1, 1) == ":" then
      params[part:sub(2)] = actual_part
    elseif part ~= actual_part then
      return false, nil
    end
  end

  return true, params
end

-- ── app ──────────────────────────────────────────────────────────────────────

function M.app(routes)
  local app = { _routes = routes }

  function app.dispatch(method, path, body)
    -- parse query string off path
    local clean_path, query_string = path:match("^([^?]*)%??(.*)")
    clean_path = clean_path or path

    -- parse body as form (key=value&key2=value2)
    local form = {}
  if body then
    for k, v in (body .. "&"):gmatch("([^=&]+)=([^&]*)&") do
      form[url_decode(k)] = url_decode(v)
    end
  end

    -- parse query params
    local query = {}
  if query_string and query_string ~= "" then
    for k, v in (query_string .. "&"):gmatch("([^=&]+)=([^&]*)&") do
      query[url_decode(k)] = url_decode(v)
    end
  end

    for _, route_def in ipairs(routes) do
      if route_def.method == method then
        local matched, params = match_path(route_def.path, clean_path)
        if matched then
          local req = {
            method = method,
            path = clean_path,
            params = params or {},
            query = query,
            form = form,
            body = body,
          }

          -- wrap in xpcall so crashes return useful errors
          local ok, resp = xpcall(
            function()
              return route_def.handler(req)
            end,
            function(err)
              local trace = ""
              if debug and debug.traceback then
                trace = debug.traceback(err, 2)
              end
              return { _type = "crash", err = tostring(err), trace = trace }
            end
          )

          if ok then
            return resp
          end
          return resp
        end
      end
    end

    return { _type = "not_found", path = path }
  end

  return app
end

-- ── dev error renderer ───────────────────────────────────────────────────────
-- Call this in your top-level runner to get readable HTML for errors.

function M.dev_error_html(resp)
  if resp._type == "error" then
    return string.format([[
<div style="font-family:monospace;background:#1a1a2e;color:#e94560;padding:16px;border-radius:8px;margin:8px">
  <b>Action error</b><br>
  action: %s &nbsp; line: %s<br>
  expr: <code>%s</code><br>
  kind: %s<br>
  message: %s
</div>
]],
      resp.action or "?",
      resp.line or "?",
      resp.expr or "?",
      resp.err and resp.err.kind or "?",
      resp.err and resp.err.message or "?"
    )
  elseif resp._type == "crash" then
    return string.format([[
<div style="font-family:monospace;background:#1a1a2e;color:#ff6b6b;padding:16px;border-radius:8px;margin:8px">
  <b>Lua crash</b><br>
  <pre>%s</pre>
</div>
]], resp.trace or resp.err or "unknown")
  end
  return ""
end

return M
