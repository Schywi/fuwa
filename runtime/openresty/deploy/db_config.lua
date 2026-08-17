local M = {}

local DEFAULT_DB_PATH = ".fuwa-dev/deployments.sqlite"

function M.path()
	if type(_G.__FUWA_DEPLOY_DB_PATH) == "string" and _G.__FUWA_DEPLOY_DB_PATH ~= "" then
		return _G.__FUWA_DEPLOY_DB_PATH
	end

	return os.getenv("FUWA_DEPLOY_DB_PATH") or DEFAULT_DB_PATH
end

return M
