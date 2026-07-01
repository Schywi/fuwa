import { readFileSync } from 'node:fs';

function readBuiltin(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/**
 * Initial Lua script to setup the environment in the worker.
 * This includes print overriding and the Virtual File System (VFS) searcher.
 */
export const LUA_BOOT_SCRIPT = `
print = function(...)
  __fuwa_print(...)
end

-- Custom searcher for the Virtual File System
table.insert(package.searchers, 2, function(modname)
  local path = modname:gsub("%.", "/") .. ".lua"
  local code = __fuwa_vfs_read(path)
  if code then
    return load(code, "@" .. path)
  end
  return "\\n\\tno file '" .. path .. "' in Fuwa VFS"
end)
`;

export const BUILTIN_LIBS: Record<string, string> = {
	'fuwa/runtime/result.lua': readBuiltin('./stdlib/result.lua'),
	'fuwa/runtime/schema.lua': readBuiltin('./stdlib/schema.lua'),
	'fuwa/runtime/web.lua': readBuiltin('./stdlib/web.lua'),
	'fuwa/runtime/view.lua': readBuiltin('./stdlib/view.lua'),
	'fuwa/runtime/db.lua': readBuiltin('./stdlib/db.lua')
};
