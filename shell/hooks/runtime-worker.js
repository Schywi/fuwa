/* eslint-disable no-undef */
'use strict';

// Browser runtime worker: boots Wasmoon (Lua 5.4 in WASM) plus a SQLite-WASM
// backed DB provider, then serves run/request messages from the host session.
// Message contract mirrors runtime/browser/init.lua: in — boot, run
// (optionally carrying raw `sources` to compile in-VM before running);
// out — booted, boot_error, stdout, stderr, html, done. All messages carry
// the __fuwaBrowser marker.
//
// Vendor-local, no npm at runtime.
importScripts('/vendor/wasmoon/wasmoon-1.16.0.js');

const GLUE_WASM_URL = '/vendor/wasmoon/glue-1.16.0.wasm';
const SQLITE_MODULE_URL = '/vendor/sqlite-wasm/index.mjs';
const SQLITE_WASM_URL = '/vendor/sqlite-wasm/sqlite3.wasm';

// The Lua-side boot script: print bridge, VFS module searcher, and nothing
// else. DB and HTML bridges are installed as globals from JS.
const LUA_BOOT_SCRIPT = [
	'print = function(...)',
	'  __fuwa_print(...)',
	'end',
	'',
	'table.insert(package.searchers, 2, function(modname)',
	'  local path = modname:gsub("%.", "/") .. ".lua"',
	'  local code = __fuwa_vfs_read(path)',
	'  if code then',
	'    return load(code, "@" .. path)',
	'  end',
	'  return "\\n\\tno file \'" .. path .. "\' in fuwa VFS"',
	'end)'
].join('\n');

let lua = null;
let bootPromise = null;
let sqliteDb = null;
let sqliteModulePromise = null;
let vfs = {};
let runQueue = Promise.resolve();

function post(message) {
	self.postMessage(Object.assign({ __fuwaBrowser: true }, message));
}

// --- SQLite-WASM DB provider -------------------------------------------------
// Mirrors the sqlite_local provider semantics in runtime/fuwa-dev.lua:
// integer ids, whole-row JSON documents, ok/err response envelopes.

function dbOk(value) {
	return { ok: true, value: value };
}

function dbErr(kind, message) {
	return { ok: false, err: { kind: kind, message: message } };
}

async function loadSqliteModule() {
	if (!sqliteModulePromise) {
		sqliteModulePromise = import(SQLITE_MODULE_URL).then(function (module) {
			return module.default || module;
		});
	}
	return sqliteModulePromise;
}

async function initDatabase() {
	if (sqliteDb) {
		return sqliteDb;
	}

	const sqlite3InitModule = await loadSqliteModule();
	const sqlite3 = await sqlite3InitModule({
		locateFile: function () {
			return SQLITE_WASM_URL;
		},
	});

	sqliteDb = new sqlite3.oo1.DB(':memory:');
	sqliteDb.exec(
		'CREATE TABLE IF NOT EXISTS fuwa_docs (collection TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id))'
	);

	return sqliteDb;
}

function ensureSchema() {
	sqliteDb.exec(
		'CREATE TABLE IF NOT EXISTS fuwa_docs (collection TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id))'
	);
}

function rowsFor(collection) {
	const rows = sqliteDb.selectObjects('SELECT id, data FROM fuwa_docs WHERE collection = ? ORDER BY id', [collection]);
	return rows.map(function (entry) {
		const row = JSON.parse(entry.data);
		row.id = entry.id;
		return row;
	});
}

function nextIdFor(collection) {
	const row = sqliteDb.selectObject('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM fuwa_docs WHERE collection = ?', [collection]);
	return row && row.next != null ? row.next : 1;
}

function valuesEqual(left, right) {
	if (left === right) {
		return true;
	}
	if (left == null || right == null) {
		return false;
	}
	return String(left) === String(right);
}

function rowMatches(row, where) {
	for (const key of Object.keys(where || {})) {
		if (!valuesEqual(row[key], where[key])) {
			return false;
		}
	}
	return true;
}

function writeRow(collection, id, row) {
	const data = Object.assign({}, row);
	delete data.id;
	sqliteDb.exec({
		sql: 'INSERT OR REPLACE INTO fuwa_docs (collection, id, data) VALUES (?, ?, ?)',
		bind: [collection, id, JSON.stringify(data)],
	});
}

function dbOp(command) {
	try {
		if (!sqliteDb) {
			return dbErr('db_unavailable', 'SQLite-WASM is not initialized');
		}
		if (!command || typeof command !== 'object') {
			return dbErr('invalid_command', 'Missing DB command');
		}
		if (command.collection == null) {
			return dbErr('invalid_command', 'Missing collection name');
		}

		const collection = String(command.collection);
		const op = command.op;

		if (op === 'all') {
			return dbOk(rowsFor(collection));
		}

		if (op === 'find') {
			const row = rowsFor(collection).find((entry) => valuesEqual(entry.id, command.id));
			return row ? dbOk(row) : dbErr('not_found', 'row not found');
		}

		if (op === 'find_by') {
			const row = rowsFor(collection).find((entry) => rowMatches(entry, command.where || {}));
			return row ? dbOk(row) : dbErr('not_found', 'row not found');
		}

		if (op === 'where') {
			const limit = Number(command.limit) || 0;
			const matched = [];
			for (const row of rowsFor(collection)) {
				if (rowMatches(row, command.where || {})) {
					matched.push(row);
					if (limit > 0 && matched.length >= limit) {
						break;
					}
				}
			}
			return dbOk(matched);
		}

		if (op === 'create' || op === 'insert') {
			const row = Object.assign({}, command.data || {});
			let id = row.id;
			if (id == null) {
				id = nextIdFor(collection);
			}
			id = Number(id);
			row.id = id;
			writeRow(collection, id, row);
			return dbOk(row);
		}

		if (op === 'update') {
			const existing = rowsFor(collection).find((entry) => valuesEqual(entry.id, command.id));
			if (!existing) {
				return dbErr('not_found', 'row not found');
			}
			const row = Object.assign({}, existing, command.data || {});
			row.id = existing.id;
			writeRow(collection, existing.id, row);
			return dbOk(row);
		}

		if (op === 'delete') {
			const existing = rowsFor(collection).find((entry) => valuesEqual(entry.id, command.id));
			if (!existing) {
				return dbErr('not_found', 'row not found');
			}
			sqliteDb.exec({
				sql: 'DELETE FROM fuwa_docs WHERE collection = ? AND id = ?',
				bind: [collection, existing.id],
			});
			return dbOk(existing);
		}

		return dbErr('unsupported_op', 'Unsupported DB op: ' + String(op));
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return dbErr('db_error', text);
	}
}

// --- Lua engine ---------------------------------------------------------------

async function boot() {
	if (lua) {
		return;
	}
	if (bootPromise) {
		return bootPromise;
	}

	bootPromise = (async function () {
		const started = Date.now();

		// Boot order matters: sqlite first, then lua.
		await initDatabase();
		ensureSchema();

		const factory = new wasmoon.LuaFactory(GLUE_WASM_URL);
		lua = await factory.createEngine({
			openStandardLibs: true,
			functionTimeout: 2500
		});

		lua.global.set('set_html', function (html) {
			post({ type: 'html', html: String(html) });
		});
		lua.global.set('__fuwa_print', function () {
			const parts = Array.prototype.slice.call(arguments).map(String);
			post({ type: 'stdout', text: parts.join('\t') + '\n' });
		});
		lua.global.set('__fuwa_vfs_read', function (path) {
			return vfs[path] || null;
		});
		lua.global.set('__fuwa_db_op', function (command) {
			// runtime/stdlib/db.lua calls bridge:await(); wasmoon maps a JS
			// Promise to an awaitable proxy, so resolve through a Promise even
			// though SQLite-WASM is synchronous in this worker.
			return Promise.resolve().then(function () {
				return dbOp(command);
			});
		});

		await lua.doString(LUA_BOOT_SCRIPT);
		post({ type: 'booted', bootMs: Date.now() - started });
	})().catch(function (error) {
		bootPromise = null;
		throw error;
	});

	return bootPromise;
}

function moduleCacheResetScript(files) {
	const names = Object.keys(files)
		.filter((name) => name.endsWith('.lua'))
		.map((name) => name.slice(0, -4).replace(/\/+/g, '/').split('/').join('.'));
	if (names.length === 0) {
		return '';
	}
	const quoted = names.map((name) => '  "' + name.replace(/["\\]/g, '\\$&') + '",');
	return ['for _, moduleName in ipairs({', quoted.join('\n'), '}) do', '  package.loaded[moduleName] = nil', 'end'].join(
		'\n'
	);
}

// Compiles raw .fuwa sources inside the Lua VM (the compiler ships in the
// dev bundle VFS) and returns the compiled run files, or throws with the
// formatted diagnostics. Keeps one compiler implementation: this is the same
// package_web.build the server runs at publish time.
const LUA_COMPILE_SCRIPT = [
	'local package_web = require("runtime.stdlib.compiler.package_web")',
	'local diagnostics = require("runtime.stdlib.compiler.diagnostics")',
	'local build = package_web.build(__fuwa_sources)',
	'if diagnostics.has_errors(build.diagnostics) then',
	'  __fuwa_build_errors = diagnostics.format(build.diagnostics)',
	'  __fuwa_run_files = nil',
	'else',
	'  __fuwa_build_errors = nil',
	'  __fuwa_run_files = build.run_files',
	'end'
].join('\n');

async function compileSources(sources) {
	lua.global.set('__fuwa_sources', sources);
	await lua.doString(LUA_COMPILE_SCRIPT);
	const buildErrors = lua.global.get('__fuwa_build_errors');
	if (buildErrors) {
		throw new Error('[build] ' + String(buildErrors));
	}
	const runFiles = lua.global.get('__fuwa_run_files');
	if (!runFiles || typeof runFiles !== 'object') {
		throw new Error('[build] compiler returned no run files');
	}
	return runFiles;
}

async function runCode(id, files, target, sources) {
	const started = Date.now();
	try {
		vfs = files || {};
		await boot();
		if (!lua) {
			throw new Error('Lua did not boot');
		}

		if (sources && Object.keys(sources).length > 0) {
			const compiled = await compileSources(sources);
			vfs = Object.assign({}, files || {}, compiled);
		}

		const resetScript = moduleCacheResetScript(vfs);
		if (resetScript) {
			await lua.doString(resetScript);
		}

		const isRequest = target && target.kind === 'request';
		lua.global.set('__fuwa_is_request', !!isRequest);
		if (isRequest) {
			lua.global.set('__fuwa_method', target.method || 'GET');
			lua.global.set('__fuwa_path', target.path || '/');
			lua.global.set('__fuwa_body', target.body || '');
		}

		const entryFile = isRequest ? 'main.lua' : target && target.entryFile;
		const code = vfs[entryFile] || '';
		if (code === '') {
			throw new Error('missing entry file: ' + String(entryFile));
		}

		await lua.doString(code);

		if (isRequest) {
			await lua.doString(
				[
					'if type(handle_request) == "function" then',
					'  local result = handle_request(__fuwa_method, __fuwa_path, __fuwa_body)',
					'  if result ~= nil then',
					'    set_html(tostring(result))',
					'  end',
					'end'
				].join('\n')
			);
		}

		post({ type: 'done', id: id, ok: true, runMs: Date.now() - started });
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		post({ type: 'stderr', text: text + '\n' });
		post({ type: 'done', id: id, ok: false, runMs: Date.now() - started });
	}
}

self.onmessage = function (event) {
	const message = event.data;
	if (!message || message.__fuwaBrowser !== true) {
		return;
	}

	if (message.type === 'boot') {
		void boot().catch(function (error) {
			post({ type: 'boot_error', error: error instanceof Error ? error.message : String(error) });
		});
		return;
	}

	if (message.type === 'run') {
		runQueue = runQueue
			.then(function () {
				return runCode(message.id, message.files, message.target, message.sources);
			})
			.catch(function (error) {
				const text = error instanceof Error ? error.message : String(error);
				post({ type: 'stderr', text: text + '\n' });
				post({ type: 'done', id: message.id, ok: false, runMs: 0 });
			});
	}
};
