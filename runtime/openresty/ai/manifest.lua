local browser_runtime = require("runtime.browser.init")
local models = require("runtime.openresty.ai.models")

local M = {}

local MANIFEST_PATH = "/ai/manifest.json"

function M.matches(method, path)
	return method == "GET" and path == MANIFEST_PATH
end

function M.build_response()
	local body = browser_runtime.json.encode(models.manifest())
	return {
		status = 200,
		headers = {
			["Content-Type"] = "application/json; charset=utf-8",
			["Content-Length"] = tostring(#body),
			["Cache-Control"] = "no-cache",
			["Connection"] = "close",
		},
		body = body,
	}
end

function M.route_request(method, path)
	if not M.matches(method, path) then
		return nil
	end

	return M.build_response()
end

return M
