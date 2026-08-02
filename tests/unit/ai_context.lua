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

t.test("context assembler module exists as the narrow bounded-context seam", function()
	local assembler = read_file("plugins/ai/core/context-assembler.js")

	t.contains(assembler, "window.FuwaAIContextAssembler", "expected bounded context seam")
end)

t.test("context assembler defines bounded explain and summarize tasks", function()
	local assembler = read_file("plugins/ai/core/context-assembler.js")

	t.contains(assembler, "MAX_CONTEXT_TOKENS = 512", "expected hard context budget")
	t.contains(assembler, "return 'explain'", "expected explain task classification")
	t.contains(assembler, "return 'summarize'", "expected summarize task classification")
	t.contains(assembler, "collectSelection", "expected selected text support")
	t.contains(assembler, "collectPrimaryExcerpt", "expected bounded excerpt support")
	t.contains(assembler, "terminal.collectFormatted", "expected summarize path to include terminal context")
	t.contains(assembler, "traces.collectFormatted", "expected summarize path to include trace context")
	t.contains(assembler, "memory.findRelevant", "expected retrieval memory participation")
	t.contains(assembler, "findRelevantSync", "expected sync memory retrieval for bounded context")
	t.contains(assembler, "type: 'memory_entry'", "expected memory entries in bounded context")
	t.contains(assembler, "bounded_context_only=true", "expected prompt to declare bounded context rule")
end)

t.test("sources tool reads the active file even without pending edits", function()
	local sources = read_file("plugins/ai/tools/sources.js")

	t.contains(sources, "readActiveFileContents", "expected active file contents helper")
	t.contains(sources, "files[active_path] = active_source", "expected active file source to seed the file map")
	t.contains(sources, "collectSelection", "expected selected text collector")
	t.contains(sources, "collectPrimaryExcerpt", "expected bounded primary excerpt collector")
end)

t.test("task router prefers the bounded assembler but preserves compatibility fallback", function()
	local router = read_file("plugins/ai/core/task-router.js")

	t.contains(router, "window.FuwaAIContextAssembler", "expected router to consult bounded context assembler")
	t.contains(router, "createFallbackAssembler", "expected router to stay self-sufficient while bootstrap work is in flight")
	t.contains(router, "Assembling bounded context", "expected bounded-context status step")
	t.contains(router, "compat.callJsonModel", "expected bounded tasks to use provider compatibility model calls")
	t.contains(router, "compat.analyzeQuestion(text, onStatus)", "expected fallback to the older agent path")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d ai context tests", results.passed))
