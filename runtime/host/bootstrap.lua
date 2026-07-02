local M = {}

local function escape_html(value)
	local text = tostring(value or "")
	text = text:gsub("&", "&amp;")
	text = text:gsub("<", "&lt;")
	text = text:gsub(">", "&gt;")
	text = text:gsub('"', "&quot;")
	text = text:gsub("'", "&#39;")
	return text
end

local function humanize_payload_id(payload_id)
	local text = tostring(payload_id or "current"):gsub("_", " "):gsub("%-", " ")
	return text:gsub("^%l", string.upper)
end

function M.build_srcdoc(opts)
	opts = opts or {}

	local slot = tostring(opts.slot or "preview")
	local payload_id = tostring(opts.payload_id or "current")
	local payload_url = tostring(opts.payload_url or ("/payload/" .. payload_id .. "/"))
	local payload_label = tostring(opts.payload_label or humanize_payload_id(payload_id))

	return table.concat({
		"<!DOCTYPE html>",
		"<html>",
		"  <head>",
		'    <meta charset="utf-8" />',
		'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
		'    <base href="' .. escape_html(payload_url) .. '" />',
		'    <meta name="htmx-config" content=\'{"historyEnabled":false,"selfRequestsOnly":false,"allowScriptTags":false}\' />',
		'    <title>' .. escape_html(payload_label) .. "</title>",
		"    <style>",
		"      :root {",
		"        color-scheme: light;",
		"        font-family: Avenir Next, Segoe UI, system-ui, sans-serif;",
		"      }",
		"",
		"      html, body {",
		"        width: 100%;",
		"        height: 100%;",
		"        min-height: 100%;",
		"        margin: 0;",
		"      }",
		"",
		"      body {",
		"        background: #fff;",
		"        color: #111827;",
		"      }",
		"",
		"      #app {",
		"        min-height: 100%;",
		"      }",
		"",
		"      .shell-bootstrap-loading {",
		"        min-height: 100%;",
		"        display: grid;",
		"        place-items: center;",
		"        padding: 32px;",
		"        text-align: center;",
		"        color: #334155;",
		"      }",
		"",
		"      .shell-bootstrap-loading h2 {",
		"        margin: 0.5rem 0 0;",
		"        font-size: 1.15rem;",
		"      }",
		"",
		"      .shell-bootstrap-loading p {",
		"        margin: 0;",
		"        max-width: 32ch;",
		"        line-height: 1.55;",
		"      }",
		"",
		"      .shell-bootstrap-kicker {",
		"        margin: 0;",
		"        text-transform: uppercase;",
		"        letter-spacing: 0.18em;",
		"        font-size: 0.72rem;",
		"        color: #c47d33;",
		"        font-weight: 800;",
		"      }",
		"    </style>",
		'    <script src="https://unpkg.com/htmx.org@1.9.12"></script>',
		'    <script defer src="https://unpkg.com/petite-vue"></script>',
		"  </head>",
		'  <body data-host-slot="' .. escape_html(slot) .. '" data-payload-id="' .. escape_html(payload_id) .. '" data-payload-url="' .. escape_html(payload_url) .. '">',
		'    <main id="app" class="shell-bootstrap-loading">',
		'      <div>',
		'        <p class="shell-bootstrap-kicker">Host bootstrap</p>',
		'        <h2>Loading ' .. escape_html(payload_label) .. "</h2>",
		"        <p>Host-owned bootstrap is mounting the tenant document.</p>",
		"      </div>",
		"    </main>",
		'    <script defer src="/shell/hooks/tenant-bridge.js"></script>',
		"  </body>",
		"</html>",
	}, "\n")
end

return M
