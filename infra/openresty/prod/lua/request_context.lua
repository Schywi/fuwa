local random = require("resty.random")
local stringx = require("resty.string")

local function random_hex(bytes)
  return stringx.to_hex(assert(random.bytes(bytes, true)))
end

local headers = ngx.req.get_headers()
local request_id = headers["x-request-id"] or ngx.var.request_id

if not request_id or request_id == "" then
  request_id = random_hex(16)
end

local traceparent = headers["traceparent"]
if not traceparent or traceparent == "" then
  traceparent = "00-" .. random_hex(16) .. "-" .. random_hex(8) .. "-01"
end

ngx.var.edge_request_id = request_id
ngx.var.edge_traceparent = traceparent
