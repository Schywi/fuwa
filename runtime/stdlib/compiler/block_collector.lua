-- block_collector.lua
-- Shared utility for collecting source lines belonging to a do/end block.
-- Used by every compiler module that needs to extract a block of source
-- text from ctx.lines for tokenization.
--
-- Will become unnecessary once modules.lua is stream-native.

local strings = require("runtime.stdlib.compiler.strings")

local M = {}

--- Collect lines from ctx.lines from `index` until the matching "end"
--- (no nesting). Returns block_lines, end_index, or nil, nil on EOF.
function M.collect_simple(ctx, index)
  local block_lines = {}
  local i = index
  while i <= #ctx.lines do
    local trimmed = strings.trim(ctx.lines[i])
    if trimmed == "end" then
      return block_lines, i
    end
    block_lines[#block_lines + 1] = ctx.lines[i]
    i = i + 1
  end
  return nil, nil
end

--- Collect lines from ctx.lines from `index` until the matching "end",
--- respecting nested do/end blocks. Tracks depth via `do$` pattern.
--- Returns block_lines, end_index, or nil, nil on EOF.
function M.collect_depth(ctx, index)
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

--- Find the matching "end" line index within a block_lines table,
--- starting from start_index. Respects nested do/end depth.
--- Returns the 1-based index within block_lines, or nil.
function M.find_matching_end(block_lines, start_index)
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

return M
