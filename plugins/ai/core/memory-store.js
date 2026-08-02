(function () {
	'use strict';

	var LEGACY_STORAGE_KEY = 'fuwa_ai_memory_entries_v1';
	var MIGRATION_KEY = 'fuwa_ai_memory_sqlite_migrated_v1';
	var COLLECTION_NAME = '__ai_memory_entries__';
	var DB_FILENAME = ':localStorage:';
	var SQLITE_MODULE_URL = '/vendor/sqlite-wasm/index.mjs';
	var SQLITE_WASM_URL = '/vendor/sqlite-wasm/sqlite3.wasm';
	var MAX_ENTRIES = 120;
	var MAX_BODY_CHARS = 4000;
	var MAX_TITLE_CHARS = 160;
	var db_promise = null;
	var sqlite3_promise = null;
	var db_backend_label = 'sqlite-kvvfs';
	var cached_recent_entries = [];

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

	function read_legacy_entries() {
		try {
			return safe_parse_entries(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]');
		} catch (_err) {
			return [];
		}
	}

	async function load_sqlite3() {
		if (!sqlite3_promise) {
			sqlite3_promise = import(SQLITE_MODULE_URL)
				.then(function (module) {
					return (module.default || module)({
						locateFile: function () {
							return SQLITE_WASM_URL;
						},
					});
				});
		}
		return sqlite3_promise;
	}

	function ensure_schema(db) {
		db.exec([
			'CREATE TABLE IF NOT EXISTS ai_memory_entries (',
			'  entry_id TEXT PRIMARY KEY,',
			'  kind TEXT NOT NULL,',
			'  scope TEXT NOT NULL,',
			'  role TEXT,',
			'  source_path TEXT,',
			'  source_hash TEXT,',
			'  selection_start INTEGER,',
			'  selection_end INTEGER,',
			'  title TEXT,',
			'  body TEXT NOT NULL,',
			'  created_at INTEGER NOT NULL,',
			'  last_used_at INTEGER NOT NULL,',
			'  use_count INTEGER NOT NULL DEFAULT 0',
			');',
			'CREATE INDEX IF NOT EXISTS idx_ai_memory_recent ON ai_memory_entries(scope, created_at DESC);',
			'CREATE INDEX IF NOT EXISTS idx_ai_memory_kind ON ai_memory_entries(kind, created_at DESC);',
			'CREATE INDEX IF NOT EXISTS idx_ai_memory_role ON ai_memory_entries(role, created_at DESC);',
		].join('\n'));
	}

	function open_database(sqlite3) {
		try {
			return new sqlite3.oo1.DB(DB_FILENAME, 'ct');
		} catch (_err) {
			db_backend_label = 'sqlite-memory';
			return new sqlite3.oo1.DB(':memory:', 'ct');
		}
	}

	function migrate_legacy_entries(db) {
		if (localStorage.getItem(MIGRATION_KEY) === 'done') {
			return;
		}

		var legacy = read_legacy_entries();
		if (legacy.length > 0) {
			for (var i = 0; i < legacy.length; i++) {
				insert_or_replace(db, legacy[i]);
			}
			prune_entries(db);
		}

		try {
			localStorage.setItem(MIGRATION_KEY, 'done');
			localStorage.removeItem(LEGACY_STORAGE_KEY);
		} catch (_err) {}
	}

	async function get_db() {
		if (!db_promise) {
			db_promise = load_sqlite3().then(function (sqlite3) {
				var db = open_database(sqlite3);
				ensure_schema(db);
				migrate_legacy_entries(db);
				return db;
			});
		}
		return db_promise;
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

	function insert_or_replace(db, entry) {
		db.exec({
			sql: [
				'INSERT OR REPLACE INTO ai_memory_entries (',
				'  entry_id, kind, scope, role, source_path, source_hash,',
				'  selection_start, selection_end, title, body,',
				'  created_at, last_used_at, use_count',
				') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			].join(' '),
			bind: [
				entry.entry_id,
				entry.kind,
				entry.scope,
				entry.role,
				entry.source_path,
				entry.source_hash,
				entry.selection_start,
				entry.selection_end,
				entry.title,
				entry.body,
				entry.created_at,
				entry.last_used_at,
				entry.use_count,
			],
		});
	}

	function prune_entries(db) {
		db.exec({
			sql: [
				'DELETE FROM ai_memory_entries',
				'WHERE entry_id IN (',
				'  SELECT entry_id FROM ai_memory_entries',
				'  ORDER BY created_at DESC, entry_id DESC',
				'  LIMIT -1 OFFSET ?',
				')'
			].join(' '),
			bind: [MAX_ENTRIES],
		});
	}

	function row_to_entry(row) {
		return normalize_entry({
			entry_id: row.entry_id,
			kind: row.kind,
			scope: row.scope,
			role: row.role,
			source_path: row.source_path,
			source_hash: row.source_hash,
			selection_start: row.selection_start,
			selection_end: row.selection_end,
			title: row.title,
			body: row.body,
			created_at: row.created_at,
			last_used_at: row.last_used_at,
			use_count: row.use_count,
		});
	}

	function remember_entries(entries) {
		cached_recent_entries = trim_entries(entries || []);
		return cached_recent_entries.slice();
	}

	function select_entries(db, options) {
		options = options || {};
		var clauses = [];
		var bind = [];

		if (options.kind) {
			clauses.push('kind = ?');
			bind.push(options.kind);
		}
		if (options.scope) {
			clauses.push('scope = ?');
			bind.push(options.scope);
		}
		if (options.role) {
			clauses.push('role = ?');
			bind.push(options.role);
		}

		var sql = [
			'SELECT entry_id, kind, scope, role, source_path, source_hash,',
			'selection_start, selection_end, title, body,',
			'created_at, last_used_at, use_count',
			'FROM ai_memory_entries'
		].join(' ');

		if (clauses.length > 0) {
			sql += ' WHERE ' + clauses.join(' AND ');
		}

		sql += ' ORDER BY created_at DESC, entry_id DESC';

		var limit = as_int(options.limit);
		if (limit != null && limit > 0) {
			sql += ' LIMIT ?';
			bind.push(limit);
		}

		return db.selectObjects(sql, bind).map(row_to_entry);
	}

	function tokenize(query) {
		return String(query || '')
			.toLowerCase()
			.match(/[a-z0-9_./-]+/g) || [];
	}

	function select_relevant_entries(db, query, options) {
		options = options || {};
		var terms = tokenize(query).slice(0, 6);
		if (terms.length === 0) {
			return select_entries(db, options);
		}

		var clauses = [];
		var bind = [];
		var score_parts = [];

		if (options.scope) {
			clauses.push('scope = ?');
			bind.push(options.scope);
		}
		if (options.kind) {
			clauses.push('kind = ?');
			bind.push(options.kind);
		}

		for (var i = 0; i < terms.length; i++) {
			var like = '%' + terms[i] + '%';
			score_parts.push('(CASE WHEN lower(body) LIKE ? THEN 2 ELSE 0 END)');
			bind.push(like);
			score_parts.push('(CASE WHEN lower(coalesce(title, \'\')) LIKE ? THEN 2 ELSE 0 END)');
			bind.push(like);
			score_parts.push('(CASE WHEN lower(coalesce(source_path, \'\')) LIKE ? THEN 1 ELSE 0 END)');
			bind.push(like);
		}

		var sql = [
			'SELECT entry_id, kind, scope, role, source_path, source_hash,',
			'selection_start, selection_end, title, body,',
			'created_at, last_used_at, use_count,',
			score_parts.join(' + ') + ' AS score',
			'FROM ai_memory_entries'
		].join(' ');

		if (clauses.length > 0) {
			sql += ' WHERE ' + clauses.join(' AND ');
		}

		sql += ' ORDER BY score DESC, created_at DESC, entry_id DESC';

		var limit = as_int(options.limit);
		if (limit != null && limit > 0) {
			sql += ' LIMIT ?';
			bind.push(limit);
		}

		return db.selectObjects(sql, bind)
			.filter(function (row) { return Number(row.score || 0) > 0; })
			.map(row_to_entry);
	}

	async function save(entry) {
		var normalized = normalize_entry(entry);
		var db = await get_db();
		insert_or_replace(db, normalized);
		prune_entries(db);
		remember_entries(select_entries(db, { limit: MAX_ENTRIES }));

		try {
			await mirror_runtime_entry(normalized);
			return Object.assign({ backend: db_backend_label + '+runtime' }, normalized);
		} catch (_err) {
			return Object.assign({ backend: db_backend_label }, normalized);
		}
	}

	async function list(options) {
		var db = await get_db();
		return remember_entries(select_entries(db, options));
	}

	async function find_recent(options) {
		options = Object.assign({ limit: 8 }, options || {});
		return list(options);
	}

	async function find_relevant(query, options) {
		var db = await get_db();
		options = Object.assign({ limit: 4 }, options || {});
		return remember_entries(select_relevant_entries(db, query, options));
	}

	function find_relevant_sync(query, options) {
		options = options || {};
		var scope = options.scope;
		var kind = options.kind;
		var role = options.role;
		var limit = as_int(options.limit) || 4;
		var terms = tokenize(query).slice(0, 6);
		var rows = cached_recent_entries.slice();

		if (scope) {
			rows = rows.filter(function (entry) { return entry.scope === scope; });
		}
		if (kind) {
			rows = rows.filter(function (entry) { return entry.kind === kind; });
		}
		if (role) {
			rows = rows.filter(function (entry) { return entry.role === role; });
		}

		if (terms.length === 0) {
			return rows.slice(0, limit);
		}

		rows = rows.map(function (entry) {
			var text = [
				entry.title || '',
				entry.body || '',
				entry.source_path || ''
			].join(' ').toLowerCase();
			var score = 0;
			for (var i = 0; i < terms.length; i++) {
				if (text.indexOf(terms[i]) >= 0) score += 1;
			}
			return { entry: entry, score: score };
		}).filter(function (entry) {
			return entry.score > 0;
		}).sort(function (left, right) {
			if (right.score !== left.score) return right.score - left.score;
			return right.entry.created_at - left.entry.created_at;
		}).map(function (entry) {
			return entry.entry;
		});

		return rows.slice(0, limit);
	}

	window.FuwaAIMemoryStore = {
		legacyStorageKey: LEGACY_STORAGE_KEY,
		migrationKey: MIGRATION_KEY,
		dbFilename: DB_FILENAME,
		collection: COLLECTION_NAME,
		maxEntries: MAX_ENTRIES,
		backendLabel: function () { return db_backend_label; },
		ensureDb: get_db,
		save: save,
		list: list,
		findRecent: find_recent,
		findRelevant: find_relevant,
		findRelevantSync: find_relevant_sync,
	};
})();
