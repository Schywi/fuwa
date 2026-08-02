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

t.test("layout loads the ai memory store before panel orchestration", function()
	local layout = read_file("shell/views/layout.fuwa")

	t.contains(layout, '/plugins/ai/core/memory-store.js', "expected memory store module in layout")
	t.contains(layout, '/plugins/ai/panel.js', "expected panel entrypoint still loaded")
end)

t.test("memory store exposes bounded local persistence plus runtime mirror seam", function()
	local memory_store = read_file("plugins/ai/core/memory-store.js")

	t.contains(memory_store, "window.FuwaAIMemoryStore", "expected exported memory store")
	t.contains(memory_store, "fuwa_ai_memory_entries_v1", "expected durable local storage key")
	t.contains(memory_store, "__ai_memory_entries__", "expected runtime collection name")
	t.contains(memory_store, "MAX_ENTRIES = 120", "expected bounded memory cap")
	t.contains(memory_store, "findRecent", "expected recent-memory API")
	t.contains(memory_store, "window.FuwaAI.exec", "expected runtime mirror through existing AI bridge")
	t.contains(memory_store, "localStorage+runtime", "expected runtime mirror backend label")
end)

t.test("state tracks memory summary fields separately from provider compatibility state", function()
	local state = read_file("plugins/ai/state.js")

	t.contains(state, "memory_backend", "expected memory backend state")
	t.contains(state, "memory_recent_count", "expected bounded recent-memory count")
	t.contains(state, "memory_error", "expected memory error channel")
end)

t.test("panel persists turns through the memory store without switching default task routing", function()
	local panel = read_file("plugins/ai/panel.js")

	t.contains(panel, "window.FuwaAIMemoryStore", "expected panel to read memory store")
	t.contains(panel, "rememberTurn('user', parsed.text, 'turn')", "expected user turns to persist")
	t.contains(panel, "rememberTurn('assistant', result.answer, 'turn')", "expected assistant answers to persist")
	t.contains(panel, "rememberTurn('assistant', error_text, 'diagnostic')", "expected error turns to persist as diagnostics")
	t.contains(panel, "memory_recent_count", "expected summary to include recent memory count")
	t.contains(panel, "router.runTextTask", "expected existing task router path to remain intact")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d ai memory tests", results.passed))
