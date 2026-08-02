(function () {
	'use strict';

	var DIMENSIONS = 64;
	var cached_model = null;

	function tokenize(text) {
		return String(text || '')
			.toLowerCase()
			.match(/[a-z0-9_./-]+/g) || [];
	}

	function char_ngrams(text) {
		var compact = String(text || '').toLowerCase().replace(/\s+/g, ' ');
		var grams = [];
		for (var i = 0; i < compact.length - 2; i++) {
			grams.push(compact.slice(i, i + 3));
		}
		return grams;
	}

	function hash_term(term) {
		var hash = 2166136261;
		for (var i = 0; i < term.length; i++) {
			hash ^= term.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0) % DIMENSIONS;
	}

	function normalize_vector(vector) {
		var magnitude = 0;
		for (var i = 0; i < vector.length; i++) {
			magnitude += vector[i] * vector[i];
		}
		magnitude = Math.sqrt(magnitude);
		if (!magnitude) return vector;
		for (var j = 0; j < vector.length; j++) {
			vector[j] = Number((vector[j] / magnitude).toFixed(6));
		}
		return vector;
	}

	function build_vector(text) {
		var vector = new Array(DIMENSIONS);
		for (var i = 0; i < DIMENSIONS; i++) vector[i] = 0;

		var terms = tokenize(text);
		for (var j = 0; j < terms.length; j++) {
			vector[hash_term(terms[j])] += 1.75;
		}

		var grams = char_ngrams(text);
		for (var k = 0; k < grams.length; k++) {
			vector[hash_term(grams[k])] += 0.35;
		}

		return normalize_vector(vector);
	}

	function cosine_similarity(left, right) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return 0;
		}
		var score = 0;
		for (var i = 0; i < left.length; i++) {
			score += Number(left[i] || 0) * Number(right[i] || 0);
		}
		return Number(score.toFixed(6));
	}

	function base_result(text) {
		return {
			dimensions: DIMENSIONS,
			token_count: tokenize(text).length,
			vector: build_vector(text),
			backend: 'hash-embed-fallback',
			model_id: 'hash-embed-fallback',
		};
	}

	async function choose_model() {
		if (cached_model) return cached_model;
		if (!(window.FuwaAIModelManager && typeof window.FuwaAIModelManager.chooseModel === 'function')) {
			return null;
		}
		try {
			cached_model = await window.FuwaAIModelManager.chooseModel('memory');
			return cached_model;
		} catch (_err) {
			return null;
		}
	}

	function build_entry_text(entry) {
		return [
			entry && entry.kind,
			entry && entry.role,
			entry && entry.title,
			entry && entry.source_path,
			entry && entry.body
		].filter(Boolean).join('\n');
	}

	function embed_text_sync(text) {
		return base_result(text);
	}

	async function embed_text(text) {
		var result = base_result(text);
		var model = await choose_model();
		if (model) {
			result.model_id = model.id;
			result.backend = 'model-manager-scaffold';
			if (window.FuwaAIModelManager && window.FuwaAIModelManager.markWarm) {
				window.FuwaAIModelManager.markWarm(model.id, model.estimated_mb || 0);
			}
		}
		return result;
	}

	function embed_entry_sync(entry) {
		return embed_text_sync(build_entry_text(entry));
	}

	async function embed_entry(entry) {
		return embed_text(build_entry_text(entry));
	}

	window.FuwaAIEmbedder = {
		dimensions: DIMENSIONS,
		tokenize: tokenize,
		embedTextSync: embed_text_sync,
		embedText: embed_text,
		embedEntrySync: embed_entry_sync,
		embedEntry: embed_entry,
		cosineSimilarity: cosine_similarity,
	};
})();
