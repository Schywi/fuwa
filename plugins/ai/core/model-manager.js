(function () {
	'use strict';

	var MANIFEST_ENDPOINT = '/ai/manifest.json';
	var cached_manifest = null;
	var cached_manifest_promise = null;
	var warm_models = {};
	var warm_order = [];
	var runtime_support = {};

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function normalize_model(model) {
		return {
			id: String(model.id || ''),
			tasks: Array.isArray(model.tasks) ? model.tasks.slice() : [],
			runtime: String(model.runtime || ''),
			preferred_backend: String(model.preferred_backend || 'wasm'),
			fallback_backend: model.fallback_backend ? String(model.fallback_backend) : null,
			warm_priority: Number(model.warm_priority || 0),
			estimated_mb: Number(model.estimated_mb || 0),
			max_context_tokens: model.max_context_tokens ? Number(model.max_context_tokens) : null,
			platform_exclusions: Array.isArray(model.platform_exclusions) ? model.platform_exclusions.slice() : [],
			artifacts: Array.isArray(model.artifacts) ? model.artifacts.slice() : [],
		};
	}

	function normalize_manifest(manifest) {
		var models = Array.isArray(manifest && manifest.models) ? manifest.models.map(normalize_model) : [];
		return {
			version: Number(manifest && manifest.version || 1),
			models: models,
		};
	}

	async function fetch_manifest() {
		var response = await fetch(MANIFEST_ENDPOINT, {
			headers: {
				'Accept': 'application/json',
			},
		});
		if (!response.ok) {
			throw new Error('AI manifest request failed: ' + response.status);
		}

		return normalize_manifest(await response.json());
	}

	async function ensure_manifest() {
		if (cached_manifest) return clone(cached_manifest);
		if (cached_manifest_promise) return clone(await cached_manifest_promise);

		cached_manifest_promise = fetch_manifest();
		try {
			cached_manifest = await cached_manifest_promise;
			return clone(cached_manifest);
		} finally {
			cached_manifest_promise = null;
		}
	}

	async function get_capability() {
		if (!(window.FuwaAIBackendSelect && window.FuwaAIBackendSelect.detectCapability)) {
			throw new Error('AI backend selector is not initialized.');
		}
		return window.FuwaAIBackendSelect.detectCapability();
	}

	async function list_models_for_task(task_kind) {
		var manifest = await ensure_manifest();
		var task = String(task_kind || '');
		var models = [];

		for (var i = 0; i < manifest.models.length; i++) {
			if (manifest.models[i].tasks.indexOf(task) >= 0) {
				models.push(manifest.models[i]);
			}
		}

		models.sort(function (left, right) {
			return left.warm_priority - right.warm_priority;
		});
		return models;
	}

	async function choose_model(task_kind) {
		var capability = await get_capability();
		var models = await list_models_for_task(task_kind);
		for (var i = 0; i < models.length; i++) {
			var model = models[i];
			if (capability.ios && model.platform_exclusions.indexOf('ios_webgpu') >= 0) {
				continue;
			}
			return model;
		}
		return null;
	}

	function runtime_support_for(model) {
		if (!model) {
			return {
				available: false,
				runtime: '',
				backend: 'wasm',
				reason: 'No model selected.',
			};
		}

		var runtime = String(model.runtime || '');
		var backend = String(model.preferred_backend || 'wasm');
		if (runtime === 'onnx') {
			if (window.FuwaAIOnnxRuntime && typeof window.FuwaAIOnnxRuntime.embed === 'function') {
				return {
					available: true,
					runtime: runtime,
					backend: backend,
					reason: 'Browser ONNX runtime is available.',
				};
			}
			return {
				available: false,
				runtime: runtime,
				backend: backend,
				reason: 'Browser ONNX runtime is not vendored in this repo yet.',
			};
		}

		if (runtime === 'gen') {
			if (window.FuwaAIGenRuntime && typeof window.FuwaAIGenRuntime.generate === 'function') {
				return {
					available: true,
					runtime: runtime,
					backend: backend,
					reason: 'Local generation runtime is available.',
				};
			}
			return {
				available: false,
				runtime: runtime,
				backend: backend,
				reason: 'Local generation runtime is not wired yet.',
			};
		}

		return {
			available: false,
			runtime: runtime,
			backend: backend,
			reason: 'Unsupported local runtime: ' + runtime,
		};
	}

	async function prepare_model(task_kind) {
		var model = await choose_model(task_kind);
		if (!model) {
			return {
				model: null,
				available: false,
				runtime: '',
				backend: 'wasm',
				reason: 'No AI model matched task "' + String(task_kind || '') + '".',
			};
		}

		var support = runtime_support_for(model);
		runtime_support[model.id] = clone(support);
		return {
			model: model,
			available: support.available,
			runtime: support.runtime,
			backend: support.backend,
			reason: support.reason,
		};
	}

	function mark_warm(model_id, estimated_mb) {
		var id = String(model_id || '');
		if (!id) return;

		warm_models[id] = {
			id: id,
			estimated_mb: Number(estimated_mb || 0),
			last_used_at: Date.now(),
		};

		for (var i = warm_order.length - 1; i >= 0; i--) {
			if (warm_order[i] === id) {
				warm_order.splice(i, 1);
			}
		}
		warm_order.push(id);
	}

	function describe_state() {
		var warm = [];
		var resident_mb = 0;
		for (var i = 0; i < warm_order.length; i++) {
			var entry = warm_models[warm_order[i]];
			if (entry) {
				warm.push(clone(entry));
				resident_mb = resident_mb + entry.estimated_mb;
			}
		}

		return {
			manifest_endpoint: MANIFEST_ENDPOINT,
			warm_models: warm,
			estimated_resident_mb: resident_mb,
			runtime_support: clone(runtime_support),
		};
	}

	function clear_cache() {
		cached_manifest = null;
		cached_manifest_promise = null;
		warm_models = {};
		warm_order = [];
		runtime_support = {};
	}

	window.FuwaAIModelManager = {
		manifestEndpoint: MANIFEST_ENDPOINT,
		ensureManifest: ensure_manifest,
		getCapability: get_capability,
		listModelsForTask: list_models_for_task,
		chooseModel: choose_model,
		prepareModel: prepare_model,
		markWarm: mark_warm,
		describeState: describe_state,
		clearCache: clear_cache,
	};
})();
