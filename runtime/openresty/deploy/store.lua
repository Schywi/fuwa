-- runtime/openresty/deploy/store.lua
-- Simple file-based deployment store. Each deployment is a JSON file under
-- .fuwa-dev/deployments/{slug}.json containing pre-compiled Lua files.

local cjson = require("cjson")

local ROOT = ".fuwa-dev/deployments"

local function ensure_dir()
	os.execute("mkdir -p " .. ROOT)
end

local function path_for(slug)
	return ROOT .. "/" .. slug .. ".json"
end

function save(slug, entry, compiled_files, session_id)
	ensure_dir()
	local record = {
		entry = entry,
		compiled_files = compiled_files, -- { "main.lua" = "...", ... }
		session_id = session_id,
		created_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
	}
	local f = assert(io.open(path_for(slug), "w"))
	f:write(cjson.encode(record))
	f:close()
end

function load(slug)
	local f = io.open(path_for(slug), "r")
	if not f then
		return nil
	end
	local content = f:read("*a")
	f:close()
	local ok, record = pcall(cjson.decode, content)
	if not ok then
		return nil
	end
	return record
end

function list_by_session(session_id)
	ensure_dir()
	local results = {}
	local p = io.popen("ls " .. ROOT .. "/*.json 2>/dev/null")
	if p then
		for filename in p:lines() do
			local f = io.open(filename, "r")
			if f then
				local content = f:read("*a")
				f:close()
				local ok, record = pcall(cjson.decode, content)
				if ok and record.session_id == session_id then
					local slug = filename:match("/([^/]+)%.json$")
					table.insert(results, {slug = slug, entry = record.entry, created_at = record.created_at})
				end
			end
		end
		p:close()
	end
	return results
end
