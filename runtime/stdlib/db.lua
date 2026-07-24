-- runtime/stdlib/db.lua
-- Public Lua API over the __fuwa_db_op host bridge.
-- The host returns Promise objects; this facade hides :await().

local M = {}

local function call_host(command)
  local bridge = __fuwa_db_op(command)
  if bridge == nil then
    error("DB bridge returned nil for op " .. tostring(command.op))
  end

  local response = bridge:await()
  if response == nil then
    error("DB bridge resolved nil for op " .. tostring(command.op))
  end

  local response_type = type(response)
  if response_type ~= "table" and response_type ~= "userdata" then
    error(
      "DB bridge returned an invalid response type "
        .. response_type
        .. " for op "
        .. tostring(command.op)
        .. ": "
        .. tostring(response)
    )
  end

  -- Normalize: if the provider returned a bare table without an ok/err
  -- envelope, wrap it in {ok = true, value = ...}.  After this point
  -- every caller can rely on the envelope being present.
  if response.ok == nil then
    return { ok = true, value = response }
  end
  return response
end

local function format_error(response, op, collection)
  local err = response.err or {}
  local kind = err.kind or "db_error"
  local message = err.message or "database operation failed"
  return string.format("Db.%s(%s): %s: %s", op, collection, kind, message)
end

-- call_host guarantees the response envelope exists, so unwrap_read
-- never sees a bare table.
local function unwrap_read(response, op, collection)
  if response.ok then
    return response.value
  end

  if response.err and (response.err.kind == "not_found" or response.err.code == "not_found") then
    return nil
  end

  error(format_error(response, op, collection))
end

function M.collection(name)
  local collection_name = tostring(name)
  local collection = {}
  collection._kind = "collection"

  -- Every method uses the OOP calling convention exclusively:
  --   collection:all(opts)        → self = collection, opts  = first arg
  --   collection:find(id)         → self = collection, id    = first arg
  --   collection:create(data)     → self = collection, data  = first arg
  --   etc.

  function collection.all(self, opts)
    local response = call_host({
      op = "all",
      collection = collection_name,
      limit = opts and opts.limit,
      order = opts and opts.order,
    })
    return unwrap_read(response, "all", collection_name) or {}
  end

  function collection.find(self, id)
    local response = call_host({
      op = "find",
      collection = collection_name,
      id = id,
    })
    return unwrap_read(response, "find", collection_name)
  end

  function collection.find_by(self, where, opts)
    local response = call_host({
      op = "find_by",
      collection = collection_name,
      where = where or {},
      limit = opts and opts.limit,
      order = opts and opts.order,
    })
    return unwrap_read(response, "find_by", collection_name)
  end

  function collection.where(self, where, opts)
    local response = call_host({
      op = "where",
      collection = collection_name,
      where = where or {},
      limit = opts and opts.limit,
      order = opts and opts.order,
    })
    return unwrap_read(response, "where", collection_name) or {}
  end

  function collection.create(self, data)
    return call_host({
      op = "create",
      collection = collection_name,
      data = data or {},
    })
  end

  function collection.insert(self, data)
    return collection:create(data)
  end

  function collection.update(self, id, data)
    return call_host({
      op = "update",
      collection = collection_name,
      id = id,
      data = data or {},
    })
  end

  function collection.delete(self, id)
    return call_host({
      op = "delete",
      collection = collection_name,
      id = id,
    })
  end

  return collection
end

return M
