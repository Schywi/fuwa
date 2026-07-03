local M = {}

local message_types = {
	"boot",
	"load_payload",
	"handle_request",
	"set_html",
	"log_event",
	"fatal",
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

function M.bootstrap.build_mount_descriptor(slot, payload_id)
	return {
		kind = "browser_runtime",
		slot = tostring(slot or "preview"),
		payload_id = tostring(payload_id or "current"),
		root_id = "app",
		sandbox = "allow-scripts allow-forms allow-same-origin",
		messages = M.contract.message_types(),
		srcdoc = M.bootstrap.build_srcdoc(),
	}
end

return M
