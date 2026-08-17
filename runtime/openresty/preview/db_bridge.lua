local runtime_db = require("runtime.db")
local deploy_db = require("runtime.openresty.deploy.db_config")

local M = {}

local function error_response(message)
	return {
		ok = false,
		err = {
			kind = "db_error",
			message = tostring(message),
		}
	}
end

function M.new(opts)
	opts = opts or {}

	local slug = tostring(assert(opts.slug, "preview slug is required"))
	assert(slug ~= "", "preview slug is required")
	local provider = runtime_db.new("sqlite_local", {
		path = opts.path or deploy_db.path(),
		tenant_key = opts.tenant_key or ("preview:" .. tostring(slug)),
	})

	return function(command)
		return {
			await = function()
				local ok, response = pcall(function()
					return provider:op(command or {})
				end)
				if not ok then
					return error_response(response)
				end
				return response
			end
		}
	end
end

return M
