-- runtime/stdlib/schema.lua
-- Stores model metadata. Powers User.change.create(form) etc.

local result = require("runtime.stdlib.result")
local Db = require("runtime.stdlib.db")
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

-- ── Changeset object ─────────────────────────────────────────────────────────
-- A Changeset holds validation results plus an insert operation.
-- When ok == false, read `errors` to see what went wrong;
-- `data` contains partially-coerced form values (may be incomplete).
-- Calling :insert() on an invalid changeset returns an error result.
local Changeset = {}
Changeset.__index = Changeset

function Changeset:_insert()
  if not self.valid then
    return result.err("invalid_changeset", "Changeset is invalid", self.errors)
  end
  if not self._model.repo then
    return result.err("no_repo", "No repo configured for model " .. self._model.name)
  end
  local repo = self._model.repo
  local insert_fn = repo.insert or repo.create
  if not insert_fn then
    return result.err("no_repo", "No repo configured for model " .. self._model.name)
  end
  return insert_fn(repo, self.data)
end

function Changeset.new(model, data, errors)
  local valid = next(errors) == nil
  local cs = setmetatable({
    -- Always safe to read:
    ok      = valid,
    valid   = valid,
    invalid = not valid,
    data    = data,    -- coerced form values (partial when invalid)
    errors  = errors,  -- field-level error messages (empty when valid)
    -- Internal (used by :insert):
    _model  = model,
  }, Changeset)
  -- Also support .insert() without colon (backward-compatible)
  cs.insert = function()
    return Changeset._insert(cs)
  end
  return cs
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

    return Changeset.new(model, data, errors)
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
        return changeset:insert()
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
