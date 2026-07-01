-- fuwa/runtime/schema.lua
-- Stores model metadata. Powers User.change.create(form) etc.

local result = require("fuwa.runtime.result")
local Db = require("fuwa.runtime.db")
local M = {}

function M.field(name, ftype, flags)
  return { _kind = "field", name = name, type = ftype, flags = flags or {} }
end

function M.timestamps()
  return { _kind = "timestamps" }
end

function M.change(name, rules)
  return { _kind = "change", name = name, rules = rules }
end

-- ── coerce form values by field type ────────────────────────────────────────
local function coerce(value, ftype)
  if value == nil then
    return nil
  end
  if ftype == "integer" then
    return tonumber(value)
  end
  if ftype == "boolean" then
    if value == "true" or value == true then
      return true
    end
    if value == "false" or value == false then
      return false
    end
    return nil
  end
  return tostring(value)
end

-- ── build change handler ────────────────────────────────────────────────────
local function build_change(model, ch_def)
  return function(form)
    form = form or {}
    local data = {}
    local errors = {}

    -- accept whitelist + coerce
    for _, fname in ipairs(ch_def.rules.accept) do
      local field_meta = model._fields[fname]
      local raw = form[fname]
      if field_meta then
        data[fname] = coerce(raw, field_meta.type)

        -- apply defaults
        if data[fname] == nil and field_meta.flags.default ~= nil then
          data[fname] = field_meta.flags.default
        end
      else
        data[fname] = raw
      end
    end

    -- require validation
    for _, fname in ipairs(ch_def.rules["require"]) do
      local v = data[fname]
      if v == nil or v == "" then
        errors[fname] = fname .. " is required"
      end
    end

    local valid = next(errors) == nil
    local changeset = {
      ok = valid,
      valid = valid,
      invalid = not valid,
      data = data,
      errors = errors,
    }

    -- insert: calls model.repo.insert if available
    changeset.insert = function()
      if not model.repo then
        return result.err("no_repo", "No repo configured for model " .. model.name)
      end
      if not valid then
        return result.err("invalid_changeset", "Changeset is invalid", errors)
      end

      local repo = model.repo
      local insert_fn = repo.insert or repo.create
      if not insert_fn then
        return result.err("no_repo", "No repo configured for model " .. model.name)
      end

      return insert_fn(repo, data)
    end

    return changeset
  end
end

local function call_repo(model, methods, ...)
  if not model.repo then
    return result.err("no_repo", "No repo configured for model " .. model.name)
  end

  for _, method_name in ipairs(methods) do
    local fn = model.repo[method_name]
    if fn then
      return fn(model.repo, ...)
    end
  end

  return result.err("no_repo", "No repo configured for model " .. model.name)
end

-- ── model constructor ───────────────────────────────────────────────────────
function M.model(name, table_name, defs)
  local repo = Db.collection(table_name)
  local model = {
    name = name,
    table_name = table_name,
    _fields = {},
    _changes = {},
    change = {},
    repo = repo, -- plug in a repo at runtime
    collection = repo,
  }

  for _, def in ipairs(defs) do
    if def._kind == "field" then
      model._fields[def.name] = def
    elseif def._kind == "change" then
      model._changes[def.name] = def
      model.change[def.name] = build_change(model, def)
    elseif def._kind == "timestamps" then
      model._fields["inserted_at"] = M.field("inserted_at", "datetime", {})
      model._fields["updated_at"] = M.field("updated_at", "datetime", {})
    end
  end

  function model.all(opts)
    return call_repo(model, { "all" }, opts)
  end

  function model.find(id)
    return call_repo(model, { "find" }, id)
  end

  function model.find_by(where, opts)
    return call_repo(model, { "find_by" }, where, opts)
  end

  function model.where(where, opts)
    return call_repo(model, { "where" }, where, opts)
  end

  function model.create(data)
    if model.change.create then
      local changeset = model.change.create(data)
      if changeset and changeset.insert then
        return changeset.insert()
      end
    end
    return call_repo(model, { "create", "insert" }, data)
  end

  function model.update(id, data)
    return call_repo(model, { "update" }, id, data)
  end

  function model.delete(id)
    return call_repo(model, { "delete" }, id)
  end

  return model
end

return M
