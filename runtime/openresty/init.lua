-- runtime/openresty/init.lua
-- OpenResty worker initialization — runs once per worker via init_worker_by_lua_file.
-- Sets up the file watcher timer. Trace sink is set per-request in handler.lua.

-- File watcher: poll payloads/current/ and touch .fuwa-dev/reload-token
local WATCH_DIR = "/app/payloads/current"
local RELOAD_TOKEN = "/app/.fuwa-dev/reload-token"

local function file_watcher(premature)
	if premature then return end

	local ok, err = pcall(function()
		local mtimes = {}
		local function collect(path)
			local f = io.open(path, "rb")
			if f then
				mtimes[path] = f:seek("end")
				f:close()
			end
		end

		local p = io.popen('find "' .. WATCH_DIR .. '" -type f 2>/dev/null')
		if p then
			for line in p:lines() do
				collect(line)
			end
			p:close()
		end

		local shm = ngx.shared.traces
		if not shm then return end

		local key = "file_watcher_mtimes"
		local old_json = shm:get(key) or "{}"
		local old = require("cjson").decode(old_json)
		local changed = false

		for path, sig in pairs(mtimes) do
			if old[path] ~= sig then
				changed = true
				break
			end
		end
		if not changed then
			for path, _ in pairs(old) do
				if mtimes[path] == nil then
					changed = true
					break
				end
			end
		end

		if changed then
			local f = io.open(RELOAD_TOKEN, "w")
			if f then
				f:write(tostring(os.time()))
				f:close()
			end
			shm:set(key, require("cjson").encode(mtimes))
		end
	end)

	ngx.timer.at(0.5, file_watcher)
end

-- Start the watcher
ngx.timer.at(0.5, file_watcher)
