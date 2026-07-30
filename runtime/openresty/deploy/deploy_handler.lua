-- runtime/openresty/deploy/deploy_handler.lua
-- POST /__dev/deploy — receive files, compile, store, return preview URL.

local cjson = require("cjson")
local store = require("runtime.openresty.deploy.store")
local fuwa_dev = require("runtime.fuwa-dev")
local package_web = require("runtime.stdlib.compiler.package_web")
local diagnostics = require("runtime.stdlib.compiler.diagnostics")
local trace = require("runtime.trace")

if ngx.req.get_method() ~= "POST" then
	ngx.status = 405
	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({ok = false, error = "method not allowed"}))
	return
end

ngx.req.read_body()
local body = ngx.req.get_body_data()
local content_type = ngx.req.get_headers()["content-type"] or ""
local is_form = content_type:find("application/x-www-form-urlencoded")

local slug, entry, files

if is_form then
	-- Deploy button: auto-generate SEO-friendly word-phrase slug, read draft overlay
	local words = {"alpha","amber","aqua","aurora","blaze","breeze","cascade","celestial","cobalt","cosmic",
		"crimson","crystal","dawn","delta","echo","ember","ethereal","falcon","frost","gamma",
		"glacier","haven","horizon","iris","jade","jasper","lagoon","lunar","mirage","mist",
		"nebula","nova","onyx","opal","orbit","phoenix","prism","pulse","quartz","raptor",
		"raven","reef","rift","sage","sapphire","shadow","silver","solar","spark","stellar",
		"storm","summit","terra","tide","titan","velvet","vertex","violet","vortex","zephyr"}
	local function pick() return words[math.random(#words)] end
	local args = ngx.req.get_post_args()
	local payload_id = args.payload_id or "current"
	slug = pick() .. "-" .. pick() .. "-" .. pick()
	entry = "main.lua"
	local root_dir = fuwa_dev.ROOT_DIR or "/app"
	local payload_root = root_dir .. "/payloads/" .. payload_id
	local overlay_root = root_dir .. "/.fuwa-dev/drafts/" .. payload_id
	files = fuwa_dev.collect_payload_files(payload_root, overlay_root)
else
	-- JSON API — receive files in body
	if not body then
		ngx.status = 400
		ngx.header.content_type = "application/json"
		ngx.say(cjson.encode({ok = false, error = "empty body"}))
		return
	end

	local ok, payload = pcall(cjson.decode, body)
	if not ok then
		ngx.status = 400
		ngx.header.content_type = "application/json"
		ngx.say(cjson.encode({ok = false, error = "invalid json"}))
		return
	end

	slug = payload.slug
	entry = payload.entry
	files = payload.files
end

-- Validate input
if type(slug) ~= "string" or slug == "" or not slug:match("^[A-Za-z0-9_%-]+$") then
	ngx.status = 400
	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({ok = false, error = "invalid slug"}))
	return
end

if type(entry) ~= "string" or entry == "" then
	ngx.status = 400
	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({ok = false, error = "missing entry file"}))
	return
end

if type(files) ~= "table" or not files[entry] then
	ngx.status = 400
	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({ok = false, error = "entry file not found in files"}))
	return
end

-- Session cookie management
local session_id = ngx.var.cookie_fuwa_session
if not session_id then
	session_id = string.format("%08x-%04x-%04x", math.random(0, 0xffffffff), math.random(0, 0xffff), math.random(0, 0xffff))
	ngx.header["Set-Cookie"] = "fuwa_session=" .. session_id .. "; Path=/; SameSite=Lax"
end

-- Deploy with trace
return trace.span("deploy", {
	slug = slug,
	entry = entry,
	file_count = 0, -- will update
	total_bytes = 0, -- will update
}, function(deploy_span)
	local file_count = 0
	local total_bytes = 0

	-- Convert files to the format package_web.build expects: { filename = content }
	local source_files = {}
	for name, content in pairs(files) do
		if type(name) == "string" and type(content) == "string" then
			source_files[name] = content
			file_count = file_count + 1
			total_bytes = total_bytes + #content
		end
	end

	deploy_span:set("file_count", file_count)
	deploy_span:set("total_bytes", total_bytes)

	-- Compile .fuwa → .lua
	local compile_start = ngx.now()
	local build = package_web.build(source_files)

	if diagnostics.has_errors(build.diagnostics) then
		local message = diagnostics.format(build.diagnostics)
		deploy_span:set("status", "compile_error")
		ngx.status = 422
		ngx.header.content_type = "application/json"
		ngx.say(cjson.encode({ok = false, error = message}))
		return
	end

	deploy_span:set("compile_ms", math.floor((ngx.now() - compile_start) * 1000))
	deploy_span:set("compiled_count", 0)

	-- Collect compiled .lua files
	local compiled_files = {}
	local compiled_count = 0
	for name, source in pairs(build.run_files) do
		compiled_files[name] = source
		compiled_count = compiled_count + 1
	end
	deploy_span:set("compiled_count", compiled_count)

	-- Store to disk
	store.save(slug, entry, compiled_files, session_id)

	deploy_span:set("status", "ok")

	if is_form then
		ngx.header["HX-Redirect"] = "/p/" .. slug
		return
	end

	ngx.header.content_type = "application/json"
	ngx.say(cjson.encode({
		ok = true,
		slug = slug,
		url = "/p/" .. slug,
		compiled_count = compiled_count,
	}))
end)
