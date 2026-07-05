-- runtime/browser/init.lua
-- Browser runtime substrate.
-- Owns the worker message contract, the payload bundle the worker boots from,
-- and the tenant iframe scaffolds. The JS side (shell/hooks/runtime-session.js,
-- shell/hooks/runtime-worker.js, shell/hooks/tenant-runtime.js) implements the
-- other half of this contract; keep both in sync.

local package_web = require("runtime.stdlib.compiler.package_web")
local diagnostics = require("runtime.stdlib.compiler.diagnostics")

local M = {}

-- Worker protocol. Host -> worker: boot, run. Worker -> host: booted,
-- boot_error, stdout, stderr, html, done.
local message_types = {
	"boot",
	"booted",
	"boot_error",
	"run",
	"stdout",
	"stderr",
	"html",
	"done",
}

local message_type_lookup = {}
for _, type_name in ipairs(message_types) do
	message_type_lookup[type_name] = true
end

M.contract = {}

function M.contract.message_types()
	local out = {}
	for index, type_name in ipairs(message_types) do
		out[index] = type_name
	end
	return out
end

function M.contract.make_message(type_name, fields)
	if message_type_lookup[type_name] ~= true then
		error("Unknown browser worker message type: " .. tostring(type_name), 2)
	end

	local message = {}
	for key, value in pairs(fields or {}) do
		message[key] = value
	end

	message.__fuwaBrowser = true
	message.type = type_name
	return message
end

function M.contract.is_message(value)
	return type(value) == "table"
		and value.__fuwaBrowser == true
		and message_type_lookup[value.type] == true
end

-- Tenant bridge protocol (host page <-> tenant iframe via postMessage).
-- Mirrors shell/hooks/tenant-runtime.js.
M.contract.tenant_commands = { "clear", "swap", "reply", "stream", "activate" }
M.contract.tenant_events = { "ready", "request", "meta", "stream" }

-- JSON encoding for the bundle route. Encode-only, deterministic key order.
local function json_escape(text)
	local out = text:gsub('[%c"\\]', function(char)
		if char == '"' then
			return '\\"'
		end
		if char == "\\" then
			return "\\\\"
		end
		if char == "\n" then
			return "\\n"
		end
		if char == "\r" then
			return "\\r"
		end
		if char == "\t" then
			return "\\t"
		end
		return string.format("\\u%04x", char:byte())
	end)
	return out
end

local function is_json_array(value)
	local count = 0
	for key in pairs(value) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false, 0
		end
		count = count + 1
	end

	for index = 1, count do
		if value[index] == nil then
			return false, 0
		end
	end

	return true, count
end

local function encode_json(value)
	local value_type = type(value)
	if value_type == "nil" then
		return "null"
	end
	if value_type == "boolean" then
		return value and "true" or "false"
	end
	if value_type == "number" then
		if value % 1 == 0 then
			return string.format("%d", value)
		end
		return string.format("%.14g", value)
	end
	if value_type == "string" then
		return '"' .. json_escape(value) .. '"'
	end
	if value_type ~= "table" then
		error("cannot encode " .. value_type .. " as JSON")
	end

	local array, count = is_json_array(value)
	if array then
		local parts = {}
		for index = 1, count do
			parts[index] = encode_json(value[index])
		end
		return "[" .. table.concat(parts, ",") .. "]"
	end

	local keys = {}
	for key in pairs(value) do
		if type(key) ~= "string" then
			error("cannot encode non-string JSON object key: " .. tostring(key))
		end
		keys[#keys + 1] = key
	end
	table.sort(keys)

	local parts = {}
	for index, key in ipairs(keys) do
		parts[index] = '"' .. json_escape(key) .. '":' .. encode_json(value[key])
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

M.json = {}

function M.json.encode(value)
	return encode_json(value)
end

-- Bundle: everything the worker VFS needs to serve requests for one payload.
-- source_files: raw payload .fuwa sources. stdlib_sources: map of
-- "runtime/stdlib/<name>.lua" -> source so `require("runtime.stdlib.db")`
-- resolves inside the worker VFS.
M.bundle = {}

-- opts.include_sources: ship the raw .fuwa sources alongside the compiled
-- files so the worker can recompile edits locally (the stdlib_sources map
-- must then also carry the compiler modules). The compiler is worker-safe:
-- it touches no io/os and resolves requires through the VFS searcher.
function M.bundle.build(source_files, stdlib_sources, opts)
	opts = opts or {}
	local build = package_web.build(source_files)
	local has_errors = diagnostics.has_errors(build.diagnostics)

	local bundle = {
		ok = not has_errors,
		entry = "main.lua",
		files = {},
		diagnostics = diagnostics.format(build.diagnostics),
	}

	if not has_errors then
		for name, source in pairs(build.run_files) do
			bundle.files[name] = source
		end
		for path, source in pairs(stdlib_sources or {}) do
			bundle.files[path] = source
		end
		if opts.include_sources then
			bundle.sources = {}
			for name, source in pairs(source_files or {}) do
				bundle.sources[name] = source
			end
		end
	end

	return bundle
end

function M.bundle.to_json(bundle)
	return encode_json({
		ok = bundle.ok,
		entry = bundle.entry,
		files = bundle.files,
		sources = bundle.sources,
		diagnostics = bundle.diagnostics,
	})
end

M.bootstrap = {}

function M.bootstrap.build_srcdoc()
	return table.concat({
		"<!DOCTYPE html>",
		"<html>",
		"  <head>",
		'    <meta charset="utf-8" />',
		'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
		'    <title>runtime</title>',
		"    <style>",
		"      html, body {",
		"        width: 100%;",
		"        height: 100%;",
		"        min-height: 100%;",
		"        margin: 0;",
		"      }",
		"",
		"      body {",
		"        background: transparent;",
		"      }",
		"",
		"      #app {",
		"        min-height: 100%;",
		"      }",
		"    </style>",
		"  </head>",
		'  <body data-browser-runtime="tenant">',
		'    <div id="app"></div>',
		"  </body>",
		"</html>",
	}, "\n")
end

-- The runnable tenant document: same scaffold plus the vendor-local widget
-- stack and the tenant bridge. Served into the srcdoc iframe when the shell
-- switches the preview to the browser runtime.
function M.bootstrap.build_runtime_srcdoc()
	return table.concat({
		"<!DOCTYPE html>",
		"<html>",
		"  <head>",
		'    <meta charset="utf-8" />',
		'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
		"    <meta name=\"htmx-config\" content='{\"historyEnabled\":false,\"selfRequestsOnly\":false,\"allowScriptTags\":false}' />",
		'    <title>runtime</title>',
		"    <style>",
		"      :root {",
		"        color-scheme: dark;",
		"        --phone-safe-top: 3.5rem;",
		"        --phone-safe-right: 0px;",
		"        --phone-safe-bottom: 2rem;",
		"        --phone-safe-left: 0px;",
		"        --phone-content-x: 1rem;",
		"        --phone-statusbar-height: 1rem;",
		"      }",
		"",
		"      html, body, #phone-shell, #app {",
		"        width: 100%;",
		"        height: 100%;",
		"        min-height: 100%;",
		"      }",
		"",
		"      html, body {",
		"        margin: 0;",
		"        padding: 0;",
		"      }",
		"",
		"      body {",
		"        position: relative;",
		"        overflow: hidden;",
		"        box-sizing: border-box;",
		"        background:",
		"          radial-gradient(circle at top, rgba(96, 165, 250, 0.16), transparent 30%),",
		"          radial-gradient(circle at 85% 110%, rgba(45, 212, 191, 0.1), transparent 24%),",
		"          linear-gradient(180deg, #05070d 0%, #0b1020 54%, #050608 100%);",
		"        color: #e5eef6;",
		"        font-family: system-ui, sans-serif;",
		"      }",
		"",
		"      *, *::before, *::after {",
		"        box-sizing: border-box;",
		"      }",
		"",
		"      #phone-shell {",
		"        position: relative;",
		"        overflow: hidden;",
		"        isolation: isolate;",
		"      }",
		"",
		"      #app {",
		"        position: relative;",
		"        margin: 0;",
		"        padding: 0;",
		"        overflow: hidden;",
		"        background: transparent;",
		"        color: inherit;",
		"      }",
		"",
		"      .phone-system-ui {",
		"        position: absolute;",
		"        inset: 0;",
		"        pointer-events: none;",
		"        z-index: 2;",
		"        display: flex;",
		"        flex-direction: column;",
		"        justify-content: space-between;",
		"      }",
		"",
		"      .phone-statusbar {",
		"        min-height: var(--phone-safe-top);",
		"        display: flex;",
		"        align-items: flex-start;",
		"        justify-content: space-between;",
		"        padding:",
		"          0.7rem",
		"          calc(var(--phone-safe-right) + var(--phone-content-x))",
		"          0",
		"          calc(var(--phone-safe-left) + var(--phone-content-x));",
		"        font-size: 0.69rem;",
		"        line-height: var(--phone-statusbar-height);",
		"        font-weight: 600;",
		"        letter-spacing: 0.02em;",
		"        color: #f3f4f6;",
		"      }",
		"",
		"      .phone-statusbar-icons {",
		"        display: inline-flex;",
		"        align-items: center;",
		"        gap: 0.35rem;",
		"      }",
		"",
		"      .phone-home-indicator {",
		"        align-self: center;",
		"        margin-bottom: 0.5rem;",
		"        width: 124px;",
		"        height: 4px;",
		"        border-radius: 999px;",
		"        background: rgba(255, 255, 255, 0.22);",
		"      }",
		"",
		"      .phone-screen {",
		"        position: relative;",
		"        min-height: 100%;",
		"        height: 100%;",
		"        display: flex;",
		"        flex-direction: column;",
		"        background: transparent;",
		"        color: inherit;",
		"      }",
		"",
		"      .phone-screen-scroll {",
		"        min-height: 100%;",
		"        overflow-x: hidden;",
		"        overflow-y: auto;",
		"        overscroll-behavior-y: contain;",
		"        -webkit-overflow-scrolling: touch;",
		"      }",
		"",
		"      .phone-safe-top { padding-top: var(--phone-safe-top); }",
		"      .phone-safe-bottom { padding-bottom: var(--phone-safe-bottom); }",
		"",
		"      .phone-safe-x {",
		"        padding-left: calc(var(--phone-safe-left) + var(--phone-content-x));",
		"        padding-right: calc(var(--phone-safe-right) + var(--phone-content-x));",
		"      }",
		"",
		"      .phone-safe-all {",
		"        padding:",
		"          var(--phone-safe-top)",
		"          calc(var(--phone-safe-right) + var(--phone-content-x))",
		"          var(--phone-safe-bottom)",
		"          calc(var(--phone-safe-left) + var(--phone-content-x));",
		"      }",
		"",
		"      .phone-stack { display: flex; flex-direction: column; gap: 1rem; }",
		"      .phone-section { width: 100%; }",
		"",
		"      h1 { margin: 0; font-size: 2rem; line-height: 1.05; letter-spacing: -0.04em; }",
		"      p { margin: 0; color: #94a3b8; }",
		"      form { display: grid; gap: 0.75rem; }",
		"",
		"      a, button {",
		"        display: inline-flex;",
		"        align-items: center;",
		"        justify-content: center;",
		"        width: fit-content;",
		"        min-height: 42px;",
		"        border: 0;",
		"        border-radius: 999px;",
		"        background: #163b34;",
		"        color: white;",
		"        padding: 0 1rem;",
		"        font: inherit;",
		"        text-decoration: none;",
		"      }",
		"",
		"      input, textarea, select {",
		"        box-sizing: border-box;",
		"        width: 100%;",
		"        margin: 0;",
		"        border: 1px solid #d7cbbc;",
		"        border-radius: 0.9rem;",
		"        padding: 10px 12px;",
		"        font: inherit;",
		"        background: white;",
		"        color: inherit;",
		"      }",
		"",
		"      pre { white-space: pre-wrap; word-break: break-word; }",
		"      [x-cloak] { display: none !important; }",
		"    </style>",
		'    <script src="/vendor/htmx/htmx-1.9.12.min.js"></script>',
		'    <script defer src="/vendor/petite-vue/petite-vue-0.4.1.iife.js"></script>',
		"  </head>",
		'  <body data-browser-runtime="tenant">',
		'    <div id="phone-shell">',
		'      <div id="app"></div>',
		'      <div class="phone-system-ui" aria-hidden="true">',
		'        <div class="phone-statusbar">',
		"          <span>9:41</span>",
		'          <span class="phone-statusbar-icons">',
		"            <span>&#9646;&#9646;&#9646;</span>",
		"            <span>5G</span>",
		"            <span>&#9673;</span>",
		"          </span>",
		"        </div>",
		'        <div class="phone-home-indicator"></div>',
		"      </div>",
		"    </div>",
		'    <script src="/shell/hooks/tenant-runtime.js"></script>',
		"  </body>",
		"</html>",
	}, "\n")
end

function M.bootstrap.build_mount_descriptor(slot, payload_id)
	return {
		kind = "browser_runtime",
		slot = tostring(slot or "preview"),
		payload_id = tostring(payload_id or "current"),
		root_id = "app",
		sandbox = "allow-scripts allow-forms allow-same-origin",
		messages = M.contract.message_types(),
		bundle_url = "/runtime/" .. tostring(payload_id or "current") .. "/bundle.json",
		worker_url = "/shell/hooks/runtime-worker.js",
		srcdoc = M.bootstrap.build_srcdoc(),
	}
end

return M
