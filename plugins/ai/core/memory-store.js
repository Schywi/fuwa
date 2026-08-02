(function () {
	'use strict';

	var STORAGE_KEY = 'fuwa_ai_memory_entries_v1';
	var COLLECTION_NAME = '__ai_memory_entries__';
	var MAX_ENTRIES = 120;
	var MAX_BODY_CHARS = 4000;
	var MAX_TITLE_CHARS = 160;
	var fallback_entries = [];

	function now_ms() {
		return Date.now();
	}

	function clamp_string(value, max_chars) {
		var text = String(value == null ? '' : value).trim();
		if (text.length <= max_chars) {
			return text;
		}
		return text.slice(0, max_chars);
	}

	function as_int(value) {
		var parsed = Number(value);
		if (!isFinite(parsed)) {
			return null;
		}
		return Math.trunc(parsed);
	}

	function normalize_kind(value) {
		var kind = clamp_string(value || 'turn', 24).toLowerCase();
		if (!kind) {
			return 'turn';
		}
		return kind;
	}

	function maybe_string(value, max_chars) {
		if (value == null || value === '') {
			return null;
		}
		var text = clamp_string(value, max_chars);
		return text || null;
	}

	function make_entry_id(created_at) {
		return 'mem_' + String(created_at) + '_' + Math.random().toString(36).slice(2, 8);
	}

	function normalize_entry(input) {
		if (!input || typeof input !== 'object') {
			throw new Error('AI memory entry must be an object.');
		}

		var body = clamp_string(input.body || '', MAX_BODY_CHARS);
		if (!body) {
			throw new Error('AI memory entry body is required.');
		}

		var created_at = as_int(input.created_at) || now_ms();
		var last_used_at = as_int(input.last_used_at) || created_at;
		var use_count = as_int(input.use_count);

		return {
			entry_id: clamp_string(input.entry_id || make_entry_id(created_at), 96),
			kind: normalize_kind(input.kind),
			scope: clamp_string(input.scope || 'ai_panel', 48),
			role: maybe_string(input.role, 24),
			source_path: maybe_string(input.source_path, 260),
			source_hash: maybe_string(input.source_hash, 128),
			selection_start: as_int(input.selection_start),
			selection_end: as_int(input.selection_end),
			title: maybe_string(input.title, MAX_TITLE_CHARS),
			body: body,
			created_at: created_at,
			last_used_at: last_used_at,
			use_count: use_count == null ? 0 : Math.max(0, use_count),
		};
	}

	function sort_recent(entries) {
		return entries.slice().sort(function (left, right) {
			if (right.created_at !== left.created_at) {
				return right.created_at - left.created_at;
			}
			return String(right.entry_id).localeCompare(String(left.entry_id));
		});
	}

	function trim_entries(entries) {
		return sort_recent(entries).slice(0, MAX_ENTRIES);
	}

	function safe_parse_entries(raw) {
		var parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (_err) {
			return [];
		}
		if (!Array.isArray(parsed)) {
			return [];
		}

		var entries = [];
		for (var i = 0; i < parsed.length; i++) {
			try {
				entries.push(normalize_entry(parsed[i]));
			} catch (_err) {}
		}
		return trim_entries(entries);
	}

	function read_local_entries() {
		try {
			return safe_parse_entries(localStorage.getItem(STORAGE_KEY) || '[]');
		} catch (_err) {
			return trim_entries(fallback_entries);
		}
	}

	function write_local_entries(entries) {
		var bounded = trim_entries(entries);
		fallback_entries = bounded.slice();
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
		} catch (_err) {}
		return bounded;
	}

	function long_bracket(text) {
		var value = String(text == null ? '' : text);
		var equals = '';
		while (value.indexOf(']' + equals + ']') !== -1) {
			equals += '=';
		}
		return '[' + equals + '[' + value + ']' + equals + ']';
	}

	function to_lua(value) {
		if (value == null) {
			return 'nil';
		}
		if (typeof value === 'string') {
			return long_bracket(value);
		}
		if (typeof value === 'number') {
			return isFinite(value) ? String(value) : 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (Array.isArray(value)) {
			return '{' + value.map(to_lua).join(', ') + '}';
		}
		if (typeof value === 'object') {
			var keys = Object.keys(value).sort();
			var parts = [];
			for (var i = 0; i < keys.length; i++) {
				var key = keys[i];
				parts.push('[' + to_lua(key) + '] = ' + to_lua(value[key]));
			}
			return '{' + parts.join(', ') + '}';
		}
		return 'nil';
	}

	async function mirror_runtime_entry(entry) {
		if (!(window.FuwaAI && typeof window.FuwaAI.exec === 'function')) {
			return false;
		}

		var lua_entry = to_lua(entry);
		var code = [
			'local Db = require("runtime.stdlib.db")',
			'local memory = Db.collection(' + to_lua(COLLECTION_NAME) + ')',
			'local row = memory.insert(' + lua_entry + ')',
			'return row.value or row',
		].join('\n');

		await window.FuwaAI.exec(code);
		return true;
	}

	function apply_filters(entries, options) {
		options = options || {};
		var list = sort_recent(entries);

		if (options.kind) {
			list = list.filter(function (entry) {
				return entry.kind === options.kind;
			});
		}

		if (options.scope) {
			list = list.filter(function (entry) {
				return entry.scope === options.scope;
			});
		}

		if (options.role) {
			list = list.filter(function (entry) {
				return entry.role === options.role;
			});
		}

		var limit = as_int(options.limit);
		if (limit != null && limit > 0) {
			list = list.slice(0, limit);
		}

		return list;
	}

	async function save(entry) {
		var normalized = normalize_entry(entry);
		var entries = read_local_entries();
		entries.unshift(normalized);
		write_local_entries(entries);

		try {
			await mirror_runtime_entry(normalized);
			return Object.assign({ backend: 'localStorage+runtime' }, normalized);
		} catch (_err) {
			return Object.assign({ backend: 'localStorage' }, normalized);
		}
	}

	async function list(options) {
		return apply_filters(read_local_entries(), options);
	}

	async function find_recent(options) {
		options = Object.assign({ limit: 8 }, options || {});
		return list(options);
	}

	window.FuwaAIMemoryStore = {
		storageKey: STORAGE_KEY,
		collection: COLLECTION_NAME,
		maxEntries: MAX_ENTRIES,
		save: save,
		list: list,
		findRecent: find_recent,
	};
})();
