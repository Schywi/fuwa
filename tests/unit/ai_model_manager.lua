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

function t.eq(left, right, label)
	if left ~= right then
		error(label or string.format("expected %s == %s", tostring(left), tostring(right)), 2)
	end
end

function t.truthy(value, label)
	if not value then
		error(label or "expected truthy value", 2)
	end
end

local function read_file(path)
	local file = assert(io.open(path, "rb"))
	local contents = file:read("*a")
	file:close()
	return contents
end

t.test("backend selector exposes cached capability detection with webgpu and opfs probes", function()
	local source = read_file("plugins/ai/core/backend-select.js")

	t.contains(source, "window.FuwaAIBackendSelect", "expected backend selector export")
	t.contains(source, "detectCapability", "expected capability detector")
	t.contains(source, "navigator.gpu.requestAdapter", "expected explicit WebGPU probe")
	t.contains(source, "navigator.storage.getDirectory", "expected OPFS probe")
	t.contains(source, "tier2_webgpu", "expected desktop webgpu tier")
	t.contains(source, "tier3_cpu_only", "expected cpu-only fallback tier")
end)

t.test("model manager exposes a manifest seam without changing execution ownership", function()
	local source = read_file("plugins/ai/core/model-manager.js")
	local embedder = read_file("plugins/ai/core/embedder.js")

	t.contains(source, "window.FuwaAIModelManager", "expected model manager export")
	t.contains(source, "/ai/manifest.json", "expected manifest endpoint")
	t.contains(source, "ensureManifest", "expected manifest loader")
	t.contains(source, "listModelsForTask", "expected task model selector")
	t.contains(source, "chooseModel", "expected capability-aware chooser")
	t.contains(source, "markWarm", "expected warm model bookkeeping scaffold")
	t.contains(embedder, "chooseModel('memory')", "expected memory embedder to consult the model manager")
end)

t.test("openresty ai manifest exposes the planned model contract", function()
	local model_catalog = require("runtime.openresty.ai.models")
	local manifest = require("runtime.openresty.ai.manifest")
	local payload = model_catalog.manifest()
	local response = manifest.build_response()

	t.eq(payload.version, 1, "expected manifest version 1")
	t.eq(#payload.models, 2, "expected initial two-model scaffold")
	t.eq(payload.models[1].id, "model2vec-potion-base-8m", "expected retrieval model first")
	t.eq(payload.models[2].id, "smollm2-135m-instruct-q4", "expected generation model second")
	t.truthy(payload.models[2].max_context_tokens == 512, "expected bounded generation context")
	t.truthy(payload.models[2].platform_exclusions[1] == "ios_webgpu", "expected ios webgpu exclusion")
	t.truthy(response.body:find('"id":"model2vec%-potion%-base%-8m"') ~= nil, "expected manifest json body")
	t.eq(response.headers["Content-Type"], "application/json; charset=utf-8", "expected json content type")
end)

if results.failed > 0 then
	io.stderr:write(string.format("%d tests failed\n\n", results.failed))
	for _, failure in ipairs(results.failures) do
		io.stderr:write(failure .. "\n\n")
	end
	os.exit(1)
end

print(string.format("ok - %d ai model manager tests", results.passed))
