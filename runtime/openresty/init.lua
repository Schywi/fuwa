-- runtime/openresty/init.lua
-- OpenResty worker initialization — runs once per worker via init_worker_by_lua_file.
-- Sets up the file watcher timer. Trace sink is set per-request in handler.lua.

local cjson = require("cjson")
local repo_watcher = require("runtime.openresty.file_watcher")

-- File watcher: poll the full worktree and touch .fuwa-dev/reload-token.
local WATCH_ROOT = "/app"
local RELOAD_TOKEN = "/app/.fuwa-dev/reload-token"

local function file_watcher(premature)
	if premature then return end

	local ok, err = pcall(function()
		local signatures = repo_watcher.collect_signatures(WATCH_ROOT)
		local shm = ngx.shared.traces
		if not shm then return end

		local key = "file_watcher_signatures"
		local old_json = shm:get(key) or "{}"
		local old = cjson.decode(old_json)
		local changed = repo_watcher.has_changes(old, signatures)

		if changed then
			local f = io.open(RELOAD_TOKEN, "w")
			if f then
				f:write(tostring(os.time()))
				f:close()
			end
			shm:set(key, cjson.encode(signatures))
		end
	end)

	if not ok then
		ngx.log(ngx.ERR, "file_watcher error: ", tostring(err))
	end

	-- Always reschedule so the watch chain never dies silently
	ngx.timer.at(0.5, file_watcher)
end

-- Start the watcher
ngx.timer.at(0.5, file_watcher)
