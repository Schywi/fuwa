-- runtime/stdlib/result.lua
-- Tiny Result type. Powers the ? sugar in action bodies.

local M = {}

function M.ok(value)
  return { ok = true, value = value }
end

function M.err(kind, message, meta)
  return {
    ok = false,
    err = {
      kind = kind or "error",
      message = message or "unknown error",
      meta = meta or {},
    },
  }
end

-- Wrap a plain Lua pcall result into a Result.
-- Usage: result.wrap(pcall(some_fn, args))
function M.wrap(ok, val_or_err)
  if ok then
    return M.ok(val_or_err)
  end
  return M.err("lua_error", tostring(val_or_err))
end

return M
