// Data provider: live runtime state via Wasmoon worker execution.
// On-demand only — triggered by /db, /modules, /vfs commands.
// Uses window.FuwaAI.exec() to run Lua snippets in the worker.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	window.FuwaAITools.runtime = {
		name: 'runtime',
		describe: 'Database schema, loaded modules, VFS listing from live worker',
		cost: '~500 tokens',
		always: false,
		triggers: ['/db', '/modules', '/vfs', 'schema', 'database', 'module', 'loaded'],

		// Synchronous stub — returns empty. The actual data is collected
		// asynchronously and injected before the API call by chat.js.
		collect: function () {
			return ''; // filled by collectAsync
		},

		collectAsync: async function (requested_tools) {
			if (!requested_tools || requested_tools.length === 0) return '';

			var exec = window.FuwaAI && window.FuwaAI.exec;
			if (!exec) return '';

			var sections = [];

			if (requested_tools.indexOf('db') !== -1 || requested_tools.indexOf('schema') !== -1) {
				try {
					var db_result = await exec(
						'local db = require("runtime.stdlib.db")\n' +
						'local tables = db.__raw_query and db.__raw_query("SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name") or {}\n' +
						'local info = {}\n' +
						'for _, t in ipairs(tables or {}) do\n' +
						'  local count = db.__raw_query and db.__raw_query("SELECT COUNT(*) as c FROM " .. t.name) or {{c=0}}\n' +
						'  info[#info + 1] = t.name .. " (" .. (count[1] and count[1].c or 0) .. " rows)"\n' +
						'end\n' +
						'return table.concat(info, "\\n")'
					);
					if (db_result && db_result.stdout) {
						var db_text = db_result.stdout.join('\n').trim();
						if (db_text) sections.push('### Database\n' + db_text);
					}
				} catch (e) {
					sections.push('### Database\n(error reading: ' + e.message + ')');
				}
			}

			if (requested_tools.indexOf('modules') !== -1) {
				try {
					var mod_result = await exec(
						'local names = {}\n' +
						'for k in pairs(package.loaded) do\n' +
						'  if type(package.loaded[k]) == "table" then names[#names + 1] = k end\n' +
						'end\n' +
						'table.sort(names)\n' +
						'return table.concat(names, "\\n")'
					);
					if (mod_result && mod_result.stdout) {
						var mod_text = mod_result.stdout.join('\n').trim();
						if (mod_text) sections.push('### Loaded Modules\n' + mod_text);
					}
				} catch (e) {
					sections.push('### Loaded Modules\n(error reading: ' + e.message + ')');
				}
			}

			if (requested_tools.indexOf('vfs') !== -1) {
				try {
					var vfs_result = await exec(
						'local files = {}\n' +
						'for k in pairs(_G) do\n' +
						'  if type(k) == "string" and k:match("%.lua$") then files[#files + 1] = k end\n' +
						'end\n' +
						'table.sort(files)\n' +
						'return table.concat(files, "\\n")'
					);
					if (vfs_result && vfs_result.stdout) {
						var vfs_text = vfs_result.stdout.join('\n').trim();
						if (vfs_text) sections.push('### VFS Files\n' + vfs_text);
					}
				} catch (e) {
					sections.push('### VFS Files\n(error reading: ' + e.message + ')');
				}
			}

			return sections.join('\n\n');
		}
	};

	window.FuwaAITools.register(window.FuwaAITools.runtime);
})();
