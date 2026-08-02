// Data provider: live runtime state via Wasmoon worker execution.
// Schema and counts are medium cost. Sample rows are expensive.
// All async; sync stubs return cached data.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	var cached_schema = null;
	var cached_modules = null;
	var cached_vfs = null;
	var CACHE_TTL_MS = 3000;
	var cache_ts = 0;

	function is_cache_fresh() {
		return cached_schema !== null && Date.now() - cache_ts < CACHE_TTL_MS;
	}

	function getExec() {
		return window.FuwaAI && window.FuwaAI.exec;
	}

	window.FuwaAITools.runtime = {
		name: 'runtime',
		describe: 'Database schema, row counts, loaded modules, VFS',
		cost: '~200-600 tokens',
		always: false,
		triggers: ['/db', '/schema', '/modules', '/vfs', 'database', 'table', 'module'],

		// ── async collectors ────────────────────────────────────────

		collectSchemaAsync: async function () {
			var exec = getExec();
			if (!exec) return null;

			try {
				var result = await exec(
					'local tables = {}\n' +
					'local rows = __fuwa_db_op({collection="__schema__", op="raw", sql="SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name"})\n' +
					'if rows and rows.value then\n' +
					'  for _, t in ipairs(rows.value) do\n' +
					'    local count_row = __fuwa_db_op({collection=t.name, op="raw", sql="SELECT COUNT(*) as cnt FROM \\"" .. t.name .. "\\""})\n' +
					'    local cnt = (count_row and count_row.value and count_row.value[1] and count_row.value[1].cnt) or 0\n' +
					'    tables[#tables + 1] = t.name .. ":" .. cnt\n' +
					'  end\n' +
					'end\n' +
					'return table.concat(tables, ",")'
				);

				if (result && result.stdout) {
					var text = result.stdout.join('').trim();
					if (text) {
						var entries = text.split(',').map(function (s) {
							var parts = s.split(':');
							return { name: parts[0], rows: parseInt(parts[1], 10) || 0 };
						});
						cached_schema = entries;
						cache_ts = Date.now();
						return { type: 'db_schema', source: 'runtime', items: [{ tables: entries }] };
					}
				}
			} catch (e) {
				// worker not booted or DB not initialized
			}
			return null;
		},

		collectSampleAsync: async function (table, limit) {
			var exec = getExec();
			if (!exec) return null;
			table = table || 'fuwa_docs';
			limit = limit || 3;

			try {
				var result = await exec(
					'local rows = __fuwa_db_op({collection="' + table + '", op="all"})\n' +
					'if not rows or not rows.value then return "[]" end\n' +
					'local subset = {}\n' +
					'for i = 1, math.min(' + limit + ', #rows.value) do\n' +
					'  subset[#subset + 1] = rows.value[i]\n' +
					'end\n' +
					'local json = require("runtime.stdlib.compiler.package_web")\n' +
					'  and require("runtime.stdlib.compiler.bootstrap") or nil\n' +
					'if json then return json.__json_encode(subset) end\n' +
					'return "[]"'
				);
				if (result && result.result) {
					try {
						var rows = JSON.parse(result.result);
						return { type: 'db_sample', source: 'runtime', items: [{ table: table, rows: rows }] };
					} catch (e) {
						return { type: 'db_sample', source: 'runtime', items: [{ table: table, rows: [] }] };
					}
				}
			} catch (e) {
				// silent
			}
			return null;
		},

		collectModulesAsync: async function () {
			var exec = getExec();
			if (!exec) return null;
			try {
				var result = await exec(
					'local names = {}\n' +
					'for k in pairs(package.loaded) do\n' +
					'  if type(package.loaded[k]) == "table" then names[#names + 1] = k end\n' +
					'end\n' +
					'table.sort(names)\n' +
					'return table.concat(names, ",")'
				);
				if (result && result.stdout) {
					var modules = result.stdout.join('').split(',').filter(function (s) { return s.trim() !== ''; });
					cached_modules = modules;
					return { type: 'modules_list', source: 'runtime', items: [{ modules: modules }] };
				}
			} catch (e) {}
			return null;
		},

		collectVfsAsync: async function () {
			var exec = getExec();
			if (!exec) return null;
			try {
				var result = await exec(
					'local vfs = {}\n' +
					'for k, v in pairs(_G) do\n' +
					'  if type(k) == "string" and type(v) ~= "function" and k:match("%.lua$") then vfs[#vfs + 1] = k end\n' +
					'end\n' +
					'table.sort(vfs)\n' +
					'return table.concat(vfs, ",")'
				);
				if (result && result.stdout) {
					var files = result.stdout.join('').split(',').filter(function (s) { return s.trim() !== ''; });
					cached_vfs = files;
					return { type: 'vfs_list', source: 'runtime', items: [{ files: files }] };
				}
			} catch (e) {}
			return null;
		},

		// ── sync stubs (return cached) ──────────────────────────────

		collectSchemaSync: function () {
			if (!is_cache_fresh()) return null;
			return { type: 'db_schema', source: 'runtime', items: [{ tables: cached_schema }] };
		},

		getCachedSample: function (table, limit) {
			return null; // sample is always async
		},

		collectModulesSync: function () {
			if (cached_modules === null) return null;
			return { type: 'modules_list', source: 'runtime', items: [{ modules: cached_modules }] };
		},

		collectVfsSync: function () {
			if (cached_vfs === null) return null;
			return { type: 'vfs_list', source: 'runtime', items: [{ files: cached_vfs }] };
		},

		collect: function () {
			return this.collectSchemaSync();
		}
	};

	window.FuwaAITools.register(window.FuwaAITools.runtime);
})();
