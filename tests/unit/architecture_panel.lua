local results = {
	passed = 0,
	failed = 0,
	failures = {},
}

local t = {}

function t.test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		results.passed = results.passed + 1
		return
	end

	results.failed = results.failed + 1
	results.failures[#results.failures + 1] = string.format("%s\n  %s", name, tostring(err))
end

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

t.test("motion hook ships detailed frontend backend and infra mermaids", function()
	local motion = read_file("shell/hooks/motion.js")

	t.contains(motion, "joinDiagram", "expected readable multi-line mermaid source builder")
	t.contains(motion, "activeArchTabName", "expected active-tab rerender helper")
	t.contains(motion, "loadMermaid: loadMermaid", "expected public architecture loader export for workspace toggle")
	t.contains(motion, "mermaidLoadPromise", "expected explicit mermaid loading lifecycle")
	t.contains(motion, "ensureMermaidRuntime", "expected promise-driven mermaid loader")
	t.contains(motion, "window.mermaid.parse(def)", "expected parse-before-render validation")
	t.contains(motion, "applyArchZoom", "expected width-based zoom helper")
	t.contains(motion, "archDrag", "expected drag-to-pan state")
	t.contains(motion, "'graph LR'", "expected graph-based frontend/backend tabs")
	t.contains(motion, "'architecture-beta'", "expected architecture-beta infra tab")
	t.contains(motion, 'group edge(cloud)[Edge and app]', "expected grouped infra topology")
	t.contains(motion, 'shell/hooks/tenant-runtime.js', "expected tenant runtime path in frontend mermaid")
	t.contains(motion, "shell/hooks/runtime-worker.js", "expected worker file path in mermaid")
	t.contains(motion, "runtime/stdlib/compiler/package_web.lua", "expected compiler boundary path in mermaid")
	t.contains(motion, "runtime/openresty/containers_live.lua", "expected actual container log module path in mermaid")
	t.contains(motion, "infra/docker-compose/dev.yml", "expected infra compose entrypoint in mermaid")
	t.contains(motion, "fontSize: '11px'", "expected denser mermaid font size for larger diagrams")
end)

t.test("layout keeps large architecture diagrams scrollable", function()
	local layout = read_file("shell/views/layout.fuwa")

	t.contains(layout, ".arch-diagram-inner svg {", "expected architecture svg styling block")
	t.contains(layout, "max-width: none;", "expected svg overflow instead of forced shrink")
	t.contains(layout, ".arch-diagram.is-draggable { cursor: grab; }", "expected draggable cursor when the diagram overflows")
	t.contains(layout, ".arch-diagram.is-dragging {", "expected dragging state styling")
end)

t.test("architecture prompt records the current repo corrections", function()
	local prompt = read_file("docs/ui/architecture-prompt.md")

	t.contains(prompt, "Current Repo Corrections", "expected prompt correction section")
	t.contains(prompt, "July 28, 2026", "expected explicit correction date")
	t.contains(prompt, "runtime/openresty/containers_live.lua", "expected corrected container log path")
	t.contains(prompt, "shell/hooks/motion.js", "expected panel source-of-truth note")
	t.contains(prompt, "infra/docker-compose/dev.yml", "expected corrected dev infra topology reference")
end)

t.test("workspace and tenant runtime keep architecture and vendor assets on the host path", function()
	local workspace = read_file("shell/hooks/workspace.js")
	local tenant = read_file("shell/hooks/tenant-runtime.js")

	t.contains(workspace, "window.FuwaShellMotion.loadMermaid()", "expected workspace to call the exported motion hook")
	t.contains(tenant, "function isHostManagedPath(path)", "expected tenant host-path guard")
	t.contains(tenant, "path.startsWith('/vendor/')", "expected vendor assets to stay rooted at /vendor")
	t.contains(tenant, "path.startsWith('/shell/')", "expected shell assets to stay rooted at /shell")
	t.contains(tenant, "path.startsWith('/runtime/')", "expected runtime assets to stay rooted at /runtime")
	t.contains(tenant, "if (isHostManagedPath(path)) {", "expected rebasing bypass for host-managed assets")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d architecture panel tests", results.passed))
