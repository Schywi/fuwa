-- runtime/openresty/containers_live.lua
-- /__dev/containers/live?name=X&name=Y&errors_only=1 — SSE stream of docker logs.
-- Polls docker logs --tail each cycle (non-following) for simplicity.

local sse = require("runtime.openresty.sse")
local cjson = require("cjson")

local args = ngx.req.get_uri_args()
local names = {}
local errors_only = false

if type(args.name) == "table" then
	names = args.name
elseif type(args.name) == "string" then
	names = {args.name}
end

if args.errors_only and args.errors_only ~= "0" then
	errors_only = true
end

-- Validate container names
local valid = {}
for _, n in ipairs(names) do
	n = n:gsub("%s+", "")
	if n ~= "" and n:match("^[A-Za-z0-9_-]+$") then
		table.insert(valid, n)
	end
end

sse.start_stream()

if #valid == 0 then
	sse.send_event("error", cjson.encode({message = "no valid container names provided"}))
	return
end

sse.send_event("ready", cjson.encode({containers = valid}))

-- Per-container tail line offset tracking
local offsets = {}
local error_pattern = "[Ee]rror|[Ww]arn|[Ff]ail|[Ff]atal|[Pp]anic|[Ee]xception|[Tt]raceback"
local tail_lines = 100
local started = ngx.now()

while ngx.now() - started < 3600 do
	for _, name in ipairs(valid) do
		local cmd = string.format("docker logs --tail %d %s 2>&1", tail_lines, name)
		local pipe = io.popen(cmd, "r")
		if pipe then
			local lines = {}
			for line in pipe:lines() do
				table.insert(lines, line)
			end
			pipe:close()

			-- Skip lines we've already sent
			local start_idx = (offsets[name] or 0) + 1
			for i = start_idx, #lines do
				local line = lines[i]
				if not errors_only or line:match(error_pattern) then
					sse.send_event("log", cjson.encode({container = name, line = line}))
				end
			end
			offsets[name] = #lines
		end
	end

	ngx.sleep(0.5)
end
