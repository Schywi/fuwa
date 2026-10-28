-- Shell config: where the panel buttons point.
--
-- The panel endpoints are deployment specific (they live on the cluster's own
-- LoadBalancer range), so runtime/host/shell_config.lua reads them from the
-- environment and falls back to the reference LAN. This pins that contract:
-- every panel has a usable default, and an env var wins over it.

local results = { passed = 0, failed = 0, failures = {} }
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

function t.eq(actual, expected, label)
	if actual ~= expected then
		error(string.format("%s\n  expected %s, got %s", label or "not equal", tostring(expected), tostring(actual)), 2)
	end
end

function t.contains(haystack, needle, label)
	if not tostring(haystack):find(needle, 1, true) then
		error(label or string.format("expected to find %q", needle), 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"), "missing file: " .. path)
	local contents = file:read("*a")
	file:close()
	return contents
end

local ShellConfig = require("runtime.host.shell_config")

t.test("every panel has a default endpoint", function()
	local panels = ShellConfig.panels()
	local expected = {
		grafana = "http://192.168.0.245/",
		cilium = "http://192.168.0.241/",
		victoriametrics = "http://192.168.0.246/",
		sandboxes = "http://192.168.0.250/",
		argocd_host = "192.168.0.247",
		kargo_host = "192.168.0.249",
	}
	for name, url in pairs(expected) do
		t.eq(panels[name], url, "expected the reference LAN default for " .. name)
	end
	t.contains(panels.neo4j, "bolt%3A%2F%2F192.168.0.242%3A7687", "neo4j carries its preselected Bolt endpoint")
	t.contains(panels.neo4j, "preselectAuthMethod=NO_AUTH", "neo4j opens without an auth prompt")
end)

t.test("an env var overrides the default without touching the others", function()
	local real_getenv = os.getenv
	os.getenv = function(name)
		if name == "FUWA_PANEL_GRAFANA" then
			return "https://grafana.example.test/d/fuwa"
		end
		return nil
	end

	local ok, err = pcall(function()
		local panels = ShellConfig.panels()
		t.eq(panels.grafana, "https://grafana.example.test/d/fuwa", "expected the env value to win")
		t.eq(panels.cilium, "http://192.168.0.241/", "an unset panel keeps its default")
	end)

	os.getenv = real_getenv
	if not ok then
		error(err, 0)
	end
end)

t.test("an empty env var is treated as unset", function()
	local real_getenv = os.getenv
	os.getenv = function(name)
		if name == "FUWA_PANEL_CILIUM" then
			return ""
		end
		return nil
	end

	local ok, err = pcall(function()
		t.eq(ShellConfig.panels().cilium, "http://192.168.0.241/", "empty must not blank the button")
	end)

	os.getenv = real_getenv
	if not ok then
		error(err, 0)
	end
end)

t.test("the shell renders the panels instead of hard-coding them", function()
	local home = read_file("shell/views/fragments/home.fuwa")
	for _, name in ipairs({ "grafana", "cilium", "victoriametrics", "sandboxes", "neo4j" }) do
		t.contains(home, "&dashboard.panels." .. name, "expected the " .. name .. " button to bind the config")
	end
	t.contains(home, 'data-panel-argocd-host="&dashboard.panels.argocd_host"', "expected the argo host exposed to the shell")
	t.contains(home, 'data-panel-kargo-host="&dashboard.panels.kargo_host"', "expected the kargo host exposed to the shell")
	if home:find("192.168.0.", 1, true) then
		error("home.fuwa must not carry an address of its own")
	end
end)

t.test("the dashboard feeds the panels into the view", function()
	local dashboard = read_file("runtime/host/dashboard.lua")
	t.contains(dashboard, 'require("runtime.host.shell_config")', "expected the config module wired in")
	t.contains(dashboard, "panels = ShellConfig.panels()", "expected the panels on the dashboard table")
end)

t.test("the shell reads the routing hosts from the rendered config", function()
	local workspace = read_file("shell/hooks/workspace.js")
	t.contains(workspace, "function assistantLbRoutes()", "expected the routes to be resolved at call time")
	t.contains(workspace, "'data-panel-argocd-host'", "expected argo to read its host")
	t.contains(workspace, "'data-panel-kargo-host'", "expected kargo to read its host")
	if workspace:find("192.168.0.", 1, true) then
		error("workspace.js must not carry an address of its own")
	end
end)

print(string.format("shell_config: %d passed, %d failed", results.passed, results.failed))
for _, failure in ipairs(results.failures) do
	print("  " .. failure)
end
if results.failed > 0 then
	os.exit(1)
end
