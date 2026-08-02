local M = {}
local ARTIFACT_PREFIX = "/ai/models/"

local function module_source_dir()
	local source = debug.getinfo(1, "S").source or ""
	source = source:gsub("^@", "")
	return source:match("^(.*)/[^/]+$") or "."
end

local function file_exists(path)
	local file = io.open(path, "rb")
	if not file then
		return false
	end
	file:close()
	return true
end

local function artifacts_root()
	return module_source_dir() .. "/models"
end

local function artifact_relative_path(path)
	if type(path) ~= "string" then
		return nil
	end
	if path:sub(1, #ARTIFACT_PREFIX) ~= ARTIFACT_PREFIX then
		return nil
	end
	local relative = path:sub(#ARTIFACT_PREFIX + 1)
	if relative == "" or relative:find("%.%.", 1, true) ~= nil then
		return nil
	end
	return relative
end

local function artifact_fs_path(path)
	local relative = artifact_relative_path(path)
	if not relative then
		return nil
	end
	return artifacts_root() .. "/" .. relative
end

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

local function hydrate_artifact(artifact)
	local item = clone(artifact)
	item.available = file_exists(artifact_fs_path(item.path))
	return item
end

local function hydrate_model(model)
	local item = clone(model)
	local missing = {}
	local artifacts = {}

	for _, artifact in ipairs(item.artifacts or {}) do
		local hydrated = hydrate_artifact(artifact)
		artifacts[#artifacts + 1] = hydrated
		if not hydrated.available then
			missing[#missing + 1] = hydrated.path
		end
	end

	item.artifacts = artifacts
	item.available = #missing == 0
	item.missing_artifacts = missing
	return item
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
	local items = {}
	for _, model in ipairs(MODELS) do
		items[#items + 1] = hydrate_model(model)
	end
	return items
end

function M.manifest()
	return {
		version = 1,
		models = M.list(),
	}
end

function M.resolve_artifact_path(path)
	for _, model in ipairs(MODELS) do
		for _, artifact in ipairs(model.artifacts or {}) do
			if artifact.path == path then
				return artifact_fs_path(path)
			end
		end
	end
	return nil
end

return M
