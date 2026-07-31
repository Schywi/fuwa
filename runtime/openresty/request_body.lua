-- runtime/openresty/request_body.lua
-- Reads an OpenResty request body from memory or, when nginx buffered it,
-- from the temporary body file path.

local M = {}

local function read_file(path)
	if type(path) ~= "string" or path == "" then
		return nil, "missing body file path"
	end

	local file = io.open(path, "rb")
	if not file then
		return nil, "body file unreadable"
	end

	local contents = file:read("*a")
	file:close()
	if contents == nil or contents == "" then
		return nil, "empty body"
	end

	return contents
end

function M.read(ngx_req)
	local req = ngx_req or (ngx and ngx.req) or nil
	if req == nil then
		return nil, "request api unavailable"
	end

	req.read_body()

	local in_memory = req.get_body_data()
	if in_memory ~= nil and in_memory ~= "" then
		return in_memory
	end

	local temp_path = req.get_body_file and req.get_body_file() or nil
	if temp_path ~= nil and temp_path ~= "" then
		return read_file(temp_path)
	end

	return nil, "empty body"
end

return M
