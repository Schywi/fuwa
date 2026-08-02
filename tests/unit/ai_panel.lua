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

function t.falsy(value, label)
	if value then
		error(label or "expected falsy value", 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

t.test("ai layout loads panel modules instead of the old chat monolith", function()
	local layout = read_file("shell/views/layout.fuwa")

	t.contains(layout, '/plugins/ai/state.js', "expected AI state module")
	t.contains(layout, '/plugins/ai/commands.js', "expected AI commands module")
	t.contains(layout, '/plugins/ai/core/provider-compat.js', "expected provider compatibility layer")
	t.contains(layout, '/plugins/ai/core/task-router.js', "expected task router module")
	t.contains(layout, '/plugins/ai/panel.js', "expected AI panel entrypoint")
	t.falsy(layout:find('/plugins/ai/chat.js', 1, true) ~= nil, "expected old chat entrypoint to be removed from layout")
end)

t.test("workspace copy describes a task-first runtime instead of a provider-branded chat", function()
	local workspace = read_file("shell/views/fragments/workspace.fuwa")

	t.contains(workspace, "AI Runtime", "expected task runtime title")
	t.contains(workspace, "Task-first AI analyst", "expected task-first intro copy")
	t.contains(workspace, "Compatibility key", "expected explicit provider-compat wording")
	t.falsy(workspace:find("DeepSeek", 1, true) ~= nil, "expected no provider branding in the default panel")
end)

t.test("provider-specific model calls live only in the compatibility adapter", function()
	local compat = read_file("plugins/ai/core/provider-compat.js")
	local agent = read_file("plugins/ai/tools/agent.js")
	local orchestrator = read_file("plugins/ai/tools/orchestrator.js")
	local panel = read_file("plugins/ai/panel.js")

	t.contains(compat, "api.deepseek.com/chat/completions", "expected remote compatibility endpoint in adapter only")
	t.contains(compat, "callJsonModel", "expected shared compatibility request helper")
	t.contains(agent, "window.FuwaAIProviderCompat.callJsonModel", "expected agent to delegate through adapter")
	t.contains(orchestrator, "window.FuwaAIProviderCompat.callJsonModel", "expected orchestrator to delegate through adapter")
	t.contains(panel, "window.FuwaAITaskRouter", "expected panel to route through task router")
	t.falsy(agent:find("api.deepseek.com/chat/completions", 1, true) ~= nil, "expected no provider endpoint in agent")
	t.falsy(orchestrator:find("api.deepseek.com/chat/completions", 1, true) ~= nil, "expected no provider endpoint in orchestrator")
end)

t.test("panel modules expose stable shell seams", function()
	local state = read_file("plugins/ai/state.js")
	local commands = read_file("plugins/ai/commands.js")
	local router = read_file("plugins/ai/core/task-router.js")
	local panel = read_file("plugins/ai/panel.js")

	t.contains(state, "window.FuwaAIState", "expected exported AI state store")
	t.contains(state, "fuwa_ai_provider_key", "expected generic provider storage key")
	t.contains(state, "embedder_backend", "expected embedder state in the shared AI store")
	t.contains(commands, "set_provider_key", "expected command parser to expose provider-key command")
	t.contains(router, "runTextTask", "expected explicit task router")
	t.contains(panel, "window.FuwaShellAI", "expected shell mount API")
	t.contains(panel, "task adapters", "expected context summary to talk about task adapters")
	t.contains(panel, "embeddings ", "expected context summary to include embedder backend status")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d ai panel tests", results.passed))
