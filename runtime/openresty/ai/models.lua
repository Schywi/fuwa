local M = {}

local function clone(value)
	if type(value) ~= "table" then
		return value
	end

	local out = {}
	for key, entry in pairs(value) do
		out[key] = clone(entry)
	end
	return out
end

local MODELS = {
	{
		id = "model2vec-potion-base-8m",
		tasks = { "embed", "search", "memory" },
		runtime = "onnx",
		preferred_backend = "wasm",
		warm_priority = 1,
		estimated_mb = 35,
		platform_exclusions = {},
		artifacts = {
			{
				kind = "model",
				path = "/ai/models/model2vec-potion-base-8m/model.onnx",
			},
			{
				kind = "tokenizer",
				path = "/ai/models/model2vec-potion-base-8m/tokenizer.json",
			},
		},
	},
	{
		id = "smollm2-135m-instruct-q4",
		tasks = { "explain", "summarize" },
		runtime = "gen",
		preferred_backend = "webgpu",
		fallback_backend = "wasm",
		warm_priority = 2,
		estimated_mb = 190,
		max_context_tokens = 512,
		platform_exclusions = { "ios_webgpu" },
		artifacts = {
			{
				kind = "weights",
				path = "/ai/models/smollm2-135m-instruct-q4/model.gguf",
			},
			{
				kind = "tokenizer",
				path = "/ai/models/smollm2-135m-instruct-q4/tokenizer.json",
			},
		},
	},
}

function M.list()
	return clone(MODELS)
end

function M.manifest()
	return {
		version = 1,
		models = M.list(),
	}
end

return M
