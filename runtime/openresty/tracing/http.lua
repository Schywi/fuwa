local M = {}

function M.parse_target(url)
	if type(url) ~= "string" or url == "" then
		return nil
	end

	local host, port, path = url:match("^http://([^:/]+):?(%d*)(/.*)$")
	if not host then
		host, port = url:match("^http://([^:/]+):?(%d*)/?$")
		path = "/"
	end
	if not host then
		return nil
	end

	return {
		host = host,
		port = tonumber(port) or 80,
		path = path ~= "" and path or "/",
	}
end

local function post_json_now(premature, target, payload_json, log_label)
	if premature or not target or not payload_json then
		return
	end

	local sock = ngx.socket.tcp()
	sock:settimeout(1000)

	local ok, err = sock:connect(target.host, target.port)
	if not ok then
		ngx.log(ngx.WARN, log_label, " connect failed: ", tostring(err))
		return
	end

	local request_data = table.concat({
		"POST " .. target.path .. " HTTP/1.1\r\n",
		"Host: " .. target.host .. "\r\n",
		"Content-Type: application/json\r\n",
		"Connection: close\r\n",
		"Content-Length: " .. tostring(#payload_json) .. "\r\n\r\n",
		payload_json,
	})

	local bytes, send_err = sock:send(request_data)
	if not bytes then
		ngx.log(ngx.WARN, log_label, " send failed: ", tostring(send_err))
	end

	sock:close()
end

function M.schedule_json(target, payload_json, log_label)
	if not target or not payload_json then
		return false, "missing target or payload"
	end

	local scheduled, err = ngx.timer.at(0, post_json_now, target, payload_json, log_label or "http sink")
	if not scheduled then
		return false, err
	end
	return true
end

return M
