package.path = "./?.lua;./?/init.lua;./?/?.lua;" .. package.path

local compiler = require("runtime.stdlib.compiler")
local package_web = require("runtime.stdlib.compiler.package_web")
local host_caps = require("runtime.host.capabilities")

local function read_file(path)
	local file = assert(io.open(path, "r"))
	local contents = file:read("*a")
	file:close()
	return contents
end

local function collect_files(root)
	local files = {}
	local pipe = assert(io.popen("find " .. root .. " -type f | sort"))

	for path in pipe:lines() do
		local relative = path:sub(#root + 2)
		files[relative] = read_file(path)
	end

	pipe:close()
	return files
end

local function assert_true(condition, message)
	if not condition then
		error(message, 2)
	end
end

local function load_module_source(source, name)
	return assert(load(source, "@" .. name))()
end

local files = collect_files("shell")
local workspace_js = files["hooks/workspace.js"]
local editor_js = files["hooks/editor.js"]
local observability_js = files["hooks/observability.js"]
local motion_js = files["hooks/motion.js"]
local preview_js = files["hooks/preview.js"]
local runtime_session_js = files["hooks/runtime-session.js"]
local browser_index_js = files["hooks/browser/index.js"]
local home_fuwa = files["views/fragments/home.fuwa"]
local workspace_fuwa = files["views/fragments/workspace.fuwa"]
local layout_fuwa = files["views/layout.fuwa"]
local compile_result = compiler.compile_runtime_files(files)
assert_true(#compile_result.diagnostics == 0, "shell should compile cleanly")
assert_true(compile_result.modules["app.lua"] ~= nil, "shell should emit app.lua")
assert_true(compile_result.modules["pages/home.lua"] ~= nil, "shell should emit pages/home.lua")
assert_true(compile_result.modules["view.lua"] ~= nil, "shell should emit view.lua")
assert_true(workspace_js:find("document.addEventListener('click'", 1, true) ~= nil, "shell should close popovers on outside click")
assert_true(workspace_js:find("createState", 1, true) ~= nil, "shell should expose petite-vue workspace state")
assert_true(workspace_js:find("open_popover", 1, true) ~= nil, "shell should keep a single popover source of truth")
assert_true(workspace_js:find("openPalette", 1, true) ~= nil, "shell should expose a command palette entrypoint")
assert_true(workspace_js:find("event.metaKey || event.ctrlKey", 1, true) ~= nil, "shell should support the cmd-k shortcut")
assert_true(workspace_js:find("boot:mount-shell", 1, true) ~= nil, "shell should mount petite-vue on the stable parent")
assert_true(workspace_js:find("document.querySelector('[data-workspace]')", 1, true) ~= nil, "shell should remount the live workspace after swaps")
assert_true(workspace_js:find("htmx:afterSwap", 1, true) ~= nil, "shell should remount petite-vue after swaps")
assert_true(workspace_js:find("import { mountAll as mountTmuxPanels } from './tmux.js';", 1, true) ~= nil, "workspace should import tmux mounting from the ESM helper")
assert_true(workspace_js:find("import { loadMermaid as loadMermaidDiagram } from './motion.js';", 1, true) ~= nil, "workspace should import the motion loader helper")
assert_true(workspace_js:find("mountTmuxPanels();", 1, true) ~= nil, "workspace should call the imported tmux mount helper")
assert_true(workspace_js:find("loadMermaidDiagram();", 1, true) ~= nil, "workspace should call the imported motion helper")
assert_true(workspace_js:find("window.FuwaShellTmux", 1, true) == nil, "workspace should not read the tmux global directly")
assert_true(workspace_js:find("window.FuwaShellMotion", 1, true) == nil, "workspace should not read the motion global directly")
assert_true(browser_index_js:find("window.FuwaShellObservability = {", 1, true) ~= nil, "browser entrypoint should keep the observability compatibility global")
assert_true(browser_index_js:find("mount: mountObservability", 1, true) ~= nil, "browser entrypoint should expose observability mount controls")
assert_true(browser_index_js:find("unmount: unmountObservability", 1, true) ~= nil, "browser entrypoint should expose observability unmount controls")
assert_true(browser_index_js:find("refresh: refreshObservability", 1, true) ~= nil, "browser entrypoint should expose observability refresh controls")
assert_true(editor_js:find("lineNumbers()", 1, true) ~= nil, "shell should show line numbers in CodeMirror")
assert_true(editor_js:find("highlightActiveLineGutter()", 1, true) ~= nil, "shell should highlight the active gutter")
assert_true(editor_js:find("highlightActiveLine()", 1, true) ~= nil, "shell should highlight the active line")
assert_true(editor_js:find("highlightSpecialChars()", 1, true) ~= nil, "shell should keep special character highlighting")
assert_true(editor_js:find("drawSelection()", 1, true) ~= nil, "shell should draw editor selections")
assert_true(editor_js:find("dropCursor()", 1, true) ~= nil, "shell should show the drop cursor")
assert_true(editor_js:find("buildLuaHighlights", 1, true) ~= nil, "shell should syntax-highlight Lua locally")
assert_true(editor_js:find("cm-lua-keyword", 1, true) ~= nil, "shell should style Lua keywords")
assert_true(editor_js:find("cm-lua-string", 1, true) ~= nil, "shell should style Lua strings")
assert_true(editor_js:find("import { log as observabilityLog } from './observability.js';", 1, true) ~= nil, "editor should import observability logging")
assert_true(editor_js:find("observabilityLog('shell:editor'", 1, true) ~= nil, "editor should use the imported observability logger")
assert_true(editor_js:find("window.FuwaObservability", 1, true) == nil, "editor should not reach into the observability global directly")
assert_true(observability_js:find("ROOT_SELECTOR = '[data-obs-root]'", 1, true) ~= nil, "observability should mount against the obs root selector")
assert_true(observability_js:find("export const ROOT_SELECTOR", 1, true) ~= nil, "observability should expose an ESM root selector")
assert_true(observability_js:find("export function mount", 1, true) ~= nil, "observability should expose an ESM mount helper")
assert_true(observability_js:find("export function appendEvents", 1, true) ~= nil, "observability should expose an ESM appendEvents helper")
assert_true(observability_js:find("window.FuwaShellObservability", 1, true) == nil, "observability module should not assign the compatibility global directly")
assert_true(observability_js:find("app.unmount()", 1, true) ~= nil, "observability should tear down the previous mount before remounting")
assert_true(observability_js:find("htmx:beforeSwap", 1, true) ~= nil, "observability should clear mounts before swaps")
assert_true(observability_js:find("htmx:afterSwap", 1, true) ~= nil, "observability should remount after swaps")
assert_true(observability_js:find("data-widget-state', 'mounted'", 1, true) ~= nil, "observability should mark mounted widget state")
assert_true(observability_js:find("EventSource('/__dev/traces/live')", 1, true) ~= nil, "observability should tail trace events over SSE")

-- Verify tmux.js uses multiplexed container log stream
local tmux_js = files["hooks/tmux.js"]
assert_true(tmux_js ~= nil, "tmux.js should be present in the package")
assert_true(tmux_js:find("export function mountAll", 1, true) ~= nil, "tmux should expose an ESM mount helper")
assert_true(tmux_js:find("export function toggleFilter", 1, true) ~= nil, "tmux should expose an ESM filter helper")
assert_true(tmux_js:find("/__dev/containers/live", 1, true) ~= nil, "tmux should use single multiplexed SSE endpoint")
assert_true(tmux_js:find("connectMux", 1, true) ~= nil, "tmux should route by container name")
assert_true(tmux_js:find("EventSource('/__dev/containers/", 1, true) == nil, "tmux should not create per-pane EventSources")
assert_true(tmux_js:find("errors_only=1", 1, true) ~= nil, "tmux should request server-side error-only filtering")
assert_true(tmux_js:find("fontSize: 9", 1, true) ~= nil, "tmux should reduce the terminal font size")
assert_true(tmux_js:find("window.FuwaShellTmux", 1, true) == nil, "tmux module should not assign the compatibility global directly")

local cursor_js = files["hooks/cursor.js"]
assert_true(cursor_js ~= nil, "cursor.js should be present in the package")
assert_true(cursor_js:find("export function mount", 1, true) ~= nil, "cursor should expose an ESM mount helper")
assert_true(cursor_js:find("export function unmount", 1, true) ~= nil, "cursor should expose an ESM unmount helper")
assert_true(cursor_js:find("window.FuwaShellCursor", 1, true) == nil, "cursor module should not assign the compatibility global directly")
assert_true(preview_js:find("import { log as observabilityLog } from './observability.js';", 1, true) ~= nil, "preview should import observability logging")
assert_true(preview_js:find("observabilityLog('shell:preview'", 1, true) ~= nil, "preview should use the imported observability logger")
assert_true(preview_js:find("window.FuwaObservability", 1, true) == nil, "preview should not reach into the observability global directly")
assert_true(preview_js:find("import { create as createPreviewBrowserDriver } from './preview-browser.js';", 1, true) ~= nil, "preview should import the browser driver factory")
assert_true(preview_js:find("import { getPendingEdits, switchFile as switchEditorFile } from './editor.js';", 1, true) ~= nil, "preview should import the editor helpers")
assert_true(preview_js:find("import { write as writeTerminalOutput } from './terminal.js';", 1, true) ~= nil, "preview should import the terminal writer")
assert_true(preview_js:find("import { closePopover as closeWorkspacePopover } from './workspace.js';", 1, true) ~= nil, "preview should import the workspace popover helper")
assert_true(preview_js:find("return createPreviewBrowserDriver({", 1, true) ~= nil, "preview should build the browser driver through the imported factory")
assert_true(preview_js:find("window.FuwaPreviewBrowserDriver", 1, true) == nil, "preview should not read the preview-driver global directly")
assert_true(preview_js:find("writeTerminalOutput(payloadId(), text);", 1, true) ~= nil, "preview should route terminal writes through the imported helper")
assert_true(preview_js:find("const pendingEdits = getPendingEdits();", 1, true) ~= nil, "preview should read pending edits through the imported helper")
assert_true(preview_js:find("const pending_edits = getPendingEdits();", 1, true) ~= nil, "preview should resolve file contents through the imported helper")
assert_true(preview_js:find("switchEditorFile(editor_root, path, contents);", 1, true) ~= nil, "preview should switch editor files through the imported helper")
assert_true(preview_js:find("closeWorkspacePopover('file-select');", 1, true) ~= nil, "preview should close the workspace popover through the imported helper")
assert_true(preview_js:find("window.FuwaShellTerminal", 1, true) == nil, "preview should not read the terminal global directly")
assert_true(preview_js:find("window.FuwaShellEditor", 1, true) == nil, "preview should not read the editor global directly")
assert_true(preview_js:find("window.FuwaShellWorkspace", 1, true) == nil, "preview should not read the workspace global directly")
assert_true(runtime_session_js:find("import { appendEvents } from './observability.js';", 1, true) ~= nil, "runtime session should import the observability event sink")
assert_true(runtime_session_js:find("appendEvents(message.events);", 1, true) ~= nil, "runtime session should forward worker traces through the imported sink")
assert_true(runtime_session_js:find("window.FuwaShellObservability", 1, true) == nil, "runtime session should not read the observability global directly")
assert_true(runtime_session_js:find("export function create(options)", 1, true) ~= nil, "runtime session should expose an ESM create factory")

local terminal_js = files["hooks/terminal.js"]
assert_true(terminal_js:find("import { log as observabilityLog } from './observability.js';", 1, true) ~= nil, "terminal should import observability logging")
assert_true(terminal_js:find("observabilityLog('shell:terminal'", 1, true) ~= nil, "terminal should use the imported observability logger")
assert_true(terminal_js:find("window.FuwaObservability", 1, true) == nil, "terminal should not reach into the observability global directly")
assert_true(terminal_js:find("export function write(sessionId, text)", 1, true) ~= nil, "terminal should expose an ESM write helper")

local preview_browser_js = files["hooks/preview-browser.js"]
assert_true(preview_browser_js:find("import { create as createRuntimeSession } from './runtime-session.js';", 1, true) ~= nil, "preview browser driver should import the runtime session factory")
assert_true(preview_browser_js:find("session = createRuntimeSession({", 1, true) ~= nil, "preview browser driver should build the runtime session through the imported factory")
assert_true(preview_browser_js:find("window.FuwaRuntimeSession", 1, true) == nil, "preview browser driver should not read the runtime-session global directly")
assert_true(preview_browser_js:find("export function create(context)", 1, true) ~= nil, "preview browser driver should expose an ESM create factory")
assert_true(preview_browser_js:find("window.FuwaPreviewBrowserDriver", 1, true) == nil, "preview browser module should not assign the compatibility global directly")
assert_true(editor_js:find("export function getPendingEdits()", 1, true) ~= nil, "editor should expose an ESM pending-edits helper")
assert_true(editor_js:find("export function switchFile(root, filePath, contents)", 1, true) ~= nil, "editor should expose an ESM switchFile helper")
assert_true(workspace_js:find("export function closePopover(name)", 1, true) ~= nil, "workspace should expose an ESM closePopover helper")
assert_true(motion_js:find("export function loadMermaid()", 1, true) ~= nil, "motion should expose an ESM loadMermaid helper")
assert_true(browser_index_js:find("window.FuwaShellCursor = {", 1, true) ~= nil, "browser entrypoint should keep the cursor compatibility global")
assert_true(browser_index_js:find("window.FuwaShellTmux = {", 1, true) ~= nil, "browser entrypoint should keep the tmux compatibility global")
assert_true(browser_index_js:find("window.FuwaRuntimeSession = {", 1, true) ~= nil, "browser entrypoint should keep the runtime session compatibility global")
assert_true(browser_index_js:find("window.FuwaPreviewBrowserDriver = {", 1, true) ~= nil, "browser entrypoint should keep the preview-browser compatibility global")

assert_true(observability_js:find("expandedTraceId", 1, true) ~= nil, "observability should support per-row expand/collapse")
assert_true(observability_js:find(".stageSummary", 1, true) ~= nil, "observability should render request-centric summaries")
assert_true(observability_js:find("toggleExpand", 1, true) ~= nil, "observability should toggle row expansion on click")
assert_true(motion_js:find("joinDiagram", 1, true) ~= nil, "motion should assemble mermaid diagrams from readable line arrays")
assert_true(motion_js:find('subgraph Browser["Browser Shell"]', 1, true) ~= nil, "motion should expose the browser architecture tab")
assert_true(motion_js:find("shell/hooks/runtime-worker.js", 1, true) ~= nil, "motion should reference the worker runtime path")
assert_true(motion_js:find("runtime/stdlib/compiler/package_web.lua", 1, true) ~= nil, "motion should reference the shared compiler boundary")
assert_true(motion_js:find("runtime/openresty/containers_live.lua", 1, true) ~= nil, "motion should reference the actual container log endpoint path")
assert_true(motion_js:find("infra/docker-compose/dev.yml", 1, true) ~= nil, "motion should reference the dev infra compose entrypoint")
assert_true(motion_js:find("activeArchTabName", 1, true) ~= nil, "motion should re-render the active architecture tab after reopen")
assert_true(layout_fuwa:find('.shell-widget-shell[data-widget-kind="editor"] > div', 1, true) ~= nil, "shell should let the editor host fill the panel")
assert_true(home_fuwa:find('v-scope="FuwaShellWorkspace.createState()"', 1, true) ~= nil, "shell should mount petite-vue on the stable shell parent")
assert_true(workspace_fuwa:find('v-scope="FuwaShellWorkspace.createState()"', 1, true) == nil, "shell should not mount petite-vue on the swapped workspace")
assert_true(home_fuwa:find("expandedTraceId === request.traceId", 1, true) ~= nil, "observability should expand rows inline")

local build_result = package_web.build(files)
assert_true(#build_result.diagnostics == 0, "shell packaging should compile cleanly")
assert_true(build_result.run_files["main.lua"] ~= nil, "shell should emit main.lua")

local html
package.loaded["app"] = nil
package.loaded["view"] = nil
package.loaded["pages.home"] = nil
package.loaded["host"] = nil
_G.__fuwa_print = function() end
_G.__fuwa_db_op = function()
	error("shell proof should not touch the database")
end
_G.set_html = function(value)
	html = tostring(value)
end
_G.__fuwa_is_request = false

package.preload["host"] = function()
	return host_caps.new({ root_dir = "." })
end
package.preload["app"] = function()
	return load_module_source(build_result.run_files["app.lua"], "app.lua")
end
package.preload["view"] = function()
	return load_module_source(build_result.run_files["view.lua"], "view.lua")
end
package.preload["pages.home"] = function()
	return load_module_source(build_result.run_files["pages/home.lua"], "pages/home.lua")
end

assert(load(build_result.run_files["main.lua"], "@main.lua"))()
assert_true(type(html) == "string" and html:find("pipeline smoke test", 1, true) ~= nil, "shell should render host branding")
assert_true(html:find("<!DOCTYPE html>", 1, true) == 1, "shell should start with a doctype")
assert_true(html:find("build fuwa-gomen", 1, true) ~= nil, "shell should render the payload list")
assert_true(html:find('data-preview-stage', 1, true) ~= nil, "shell should expose the browser runtime stage")
assert_true(html:find('src="/payload/current/"', 1, true) == nil, "shell should not mount the route-backed tenant iframe by default")
assert_true(html:find("tenant-bridge.js", 1, true) == nil, "shell should not include the tenant bridge")
assert_true(html:find('/vendor/htmx/htmx-1.9.12.min.js', 1, true) ~= nil, "shell should load local htmx")
assert_true(html:find('/vendor/petite-vue/petite-vue-0.4.1.iife.js', 1, true) ~= nil, "shell should load local petite-vue")
assert_true(html:find('cdn.jsdelivr.net/npm/iconify-icon', 1, true) ~= nil, "shell should load the icon CDN requested by the user")
assert_true(html:find('/vendor/xterm/xterm-6.0.0.css', 1, true) ~= nil, "shell should load local xterm stylesheet")
assert_true(html:find('<script type="importmap">', 1, true) ~= nil, "shell should expose an import map")
assert_true(html:find('"@codemirror/state": "/vendor/codemirror/state-6.6.0.js"', 1, true) ~= nil, "shell should expose literal import map JSON")
assert_true(html:find('&quot;@codemirror/state&quot;', 1, true) == nil, "shell should not escape import map JSON")
assert_true(html:find('/shell/hooks/browser/index.js', 1, true) ~= nil, "shell should load the ESM browser entrypoint")
assert_true(html:find('/shell/hooks/editor.js', 1, true) == nil, "shell should not inline individual hook scripts")
assert_true(html:find('/shell/hooks/terminal.js', 1, true) == nil, "shell should not inline individual hook scripts")
assert_true(html:find('data-select', 1, true) ~= nil, "shell should expose a payload select control")
assert_true(html:find('hx-get="/inspect/', 1, true) ~= nil, "shell should expose file inspection links")
assert_true(html:find('hx-post="/save/current"', 1, true) == nil, "shell should not expose a save action")
assert_true(html:find('Publish + run', 1, true) == nil, "shell should not expose publish and run")
assert_true(html:find('hx-get="/inspect/fuwa-gomen?file=app.fuwa"', 1, true) ~= nil, "shell should expose file inspection links for the selected entry")
assert_true(html:find('data-editor-root', 1, true) ~= nil, "shell should expose the editor root")
assert_true(html:find('data-editor-source', 1, true) ~= nil, "shell should expose the hidden contents carrier")
assert_true(html:find('data-file-path="app.fuwa"', 1, true) ~= nil, "shell should pass the editor file path")
assert_true(html:find("<textarea", 1, true) == nil, "shell should not render a textarea fallback")
assert_true(html:find("CodeMirror mounts here.", 1, true) == nil, "shell should not render the placeholder")
assert_true(html:find('data-terminal-root', 1, true) ~= nil, "shell should expose the terminal root")
assert_true(html:find('compile + run output', 1, true) ~= nil, "shell should render the terminal stage label")
assert_true(html:find('id="ide-terminal-pill"', 1, true) == nil, "shell should not render the legacy terminal pill")
assert_true(html:find('data-terminal-session="fuwa-gomen"', 1, true) ~= nil, "shell should pass the terminal session")
assert_true(html:find('v%-scope="FuwaShellWorkspace.createState%(%)"', 1) ~= nil, "shell should mount petite-vue workspace state")
assert_true(html:find('shell%-command%-trigger', 1) ~= nil, "shell should render a single command trigger")
assert_true(html:find('data%-popover="files"', 1) ~= nil, "shell should render a single file command palette")
assert_true(html:find('.shell-widget-shell[data-widget-state="mounted"]', 1, true) ~= nil, "shell should keep CSS selectors literal")
assert_true(html:find('data-widget-state=&quot;mounted&quot;', 1, true) == nil, "shell should not escape CSS selectors")
assert_true(html:find('Build ok', 1, true) ~= nil, "shell should seed the terminal output with the compile result")
assert_true(html:find('test-panel ready · ready', 1, true) ~= nil, "shell should render the target footer copy")
assert_true(html:find('obs-request-group', 1, true) ~= nil, "shell should render request activity rows")
assert_true(html:find('obs-expand', 1, true) ~= nil, "shell should render inline expandable log area")
assert_true(html:find('obs-stream-label', 1, true) ~= nil, "shell should render stream status label")

print("shell smoke checks passed")
