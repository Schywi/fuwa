(function () {
	'use strict';

	// Host-side runtime session: the fuwa equivalent of the IDE RuntimeSession.
	// Owns the Wasmoon worker lifecycle, in-memory file state, the run/reset
	// loop, live reload debounce, and terminal streaming. The tenant command
	// relay lives in preview-browser.js. The worker protocol lives in
	// runtime/browser/init.lua (contract) and shell/hooks/runtime-worker.js.
	//
	// Browser mode is in-memory only: boot from bundle once, then own the file
	// state. No draft overlays, no server round-trips on edit.

	// Matches /IDE's RuntimeSession debounce (src/engine/RuntimeSession.ts).
	const LIVE_RELOAD_DEBOUNCE_MS = 650;

	function create(options) {
		const worker_url = options.workerUrl;
		const bundle_url = options.bundleUrl;
		const on_terminal = options.onTerminal || function () {};
		const on_status = options.onStatus || function () {};
		const send_tenant_command = options.sendTenantCommand || function () {};
		const payload_base_url = derivePayloadBaseUrl(bundle_url);

		let worker = null;
		let state = 'idle';
		let boot_promise = null;
		let bundle = null;
		let message_id = 0;
		const pending_runs = new Map();
		// In-memory file state: after boot, this is the source of truth.
		const files = new Map();
		let live_reload_timer = null;
		let current_request = null;
		let live_reload = options.liveReload !== false;

		function normalizeBasePath(value) {
			const text = typeof value === 'string' ? value.trim() : '';
			if (text === '' || text === '/') {
				return '';
			}
			return text.endsWith('/') ? text : text + '/';
		}

		function derivePayloadBaseUrl(url) {
			const match = String(url || '').match(/\/runtime\/([^/]+)\/bundle\.json$/);
			if (!match) {
				return '/payload/current/';
			}
			return '/payload/' + match[1] + '/';
		}

		function normalizeRequestPath(path, payloadBaseUrl) {
			const text = typeof path === 'string' && path !== '' ? path : '/';
			const base = normalizeBasePath(payloadBaseUrl) || '/';
			const root = base.slice(0, -1);
			if (text === root) {
				return '/';
			}
			if (text.startsWith(base)) {
				const inner = text.slice(base.length);
				return inner === '' ? '/' : '/' + inner.replace(/^\/+/, '');
			}
			return text;
		}

		function resolveResponseUrl(path) {
			const base_path = normalizeBasePath(payload_base_url) || '/';
			const request_path = typeof path === 'string' && path !== '' ? path : '/';
			const relative_path = request_path === '/' ? '' : request_path.replace(/^\/+/, '');
			try {
				const url = new URL(relative_path, 'https://tenant.invalid' + base_path);
				return url.pathname + url.search + url.hash;
			} catch {
				return base_path;
			}
		}

		function setState(next) {
			state = next;
			on_status(next);
		}

		function terminal(text) {
			on_terminal(text.replace(/\n/g, '\r\n'));
		}

		function post(message) {
			worker?.postMessage(Object.assign({ __fuwaBrowser: true }, message));
		}

		function handleWorkerMessage(event) {
			const message = event.data;
			if (!message || message.__fuwaBrowser !== true) {
				return;
			}

			if (message.type === 'booted') {
				setState('ready');
				terminal('[lua] ready. Wasmoon runs in a worker. (' + Math.round(message.bootMs || 0) + 'ms)\n');
				return;
			}
			if (message.type === 'boot_error') {
				setState('error');
				terminal('[lua] boot failed: ' + message.error + '\n');
				return;
			}
			if (message.type === 'stdout' || message.type === 'stderr') {
				terminal(message.text);
				send_tenant_command({ type: 'stream', stream: message.type, text: message.text });
				return;
			}
			if (message.type === 'html') {
				const response_url = current_request ? current_request.responseUrl : payload_base_url;
				if (current_request && current_request.requestId != null) {
					send_tenant_command({
						type: 'reply',
						requestId: current_request.requestId,
						html: message.html,
						path: response_url,
						responseUrl: response_url,
						appBasePath: payload_base_url,
						status: 200
					});
				} else {
					send_tenant_command({
						type: 'swap',
						html: message.html,
						path: response_url,
						responseUrl: response_url,
						appBasePath: payload_base_url
					});
				}
				return;
			}
			if (message.type === 'done') {
				setState(message.ok ? 'ready' : 'error');
				const resolve = pending_runs.get(message.id);
				pending_runs.delete(message.id);
				if (resolve) {
					resolve(message.ok);
				}
			}
		}

		function ensureWorker() {
			if (worker) {
				return worker;
			}
			worker = new Worker(worker_url);
			worker.onmessage = handleWorkerMessage;
			return worker;
		}

		async function loadBundle() {
			const response = await fetch(bundle_url, { credentials: 'same-origin' });
			const parsed = await response.json();
			if (!parsed.ok) {
				terminal('[lua][build] ' + (parsed.diagnostics || 'build failed') + '\n');
				throw new Error('payload build failed');
			}
			bundle = parsed;
			// Seed in-memory files from bundle sources, but preserve any edits
			// that arrived before bundle loaded (user typed while booting).
			if (bundle.sources) {
				for (const key of Object.keys(bundle.sources)) {
					if (!files.has(key)) {
						files.set(key, bundle.sources[key]);
					}
				}
			}
			return bundle;
		}

		function boot() {
			if (boot_promise) {
				return boot_promise;
			}

			boot_promise = new Promise(function (resolve, reject) {
				setState('booting');
				terminal('[lua] booting browser runtime…\n');
				const current = ensureWorker();
				const settle = function (event) {
					const message = event.data;
					if (!message || message.__fuwaBrowser !== true) {
						return;
					}
					if (message.type === 'booted') {
						current.removeEventListener('message', settle);
						resolve();
					}
					if (message.type === 'boot_error') {
						current.removeEventListener('message', settle);
						reject(new Error(message.error));
					}
				};
				current.addEventListener('message', settle);
				post({ type: 'boot' });
			}).catch(function (error) {
				boot_promise = null;
				setState('error');
				throw error;
			});

			return boot_promise;
		}

		function bundleFiles() {
			return Object.assign({}, bundle ? bundle.files : {});
		}

		function currentSources() {
			if (files.size === 0) {
				return bundle && bundle.sources ? bundle.sources : null;
			}
			const sources = Object.assign({}, bundle ? bundle.sources : {});
			for (const entry of files) {
				sources[entry[0]] = entry[1];
			}
			return sources;
		}

		function clearLiveReloadTimer() {
			if (live_reload_timer) {
				clearTimeout(live_reload_timer);
				live_reload_timer = null;
			}
		}

		function scheduleLiveRun() {
			// Mirrors /IDE's scheduleLiveRun guard: skip while reload is disabled
			// or the worker is still booting, so a burst of keystrokes during
			// boot doesn't queue a run before the worker can accept one.
			if (!live_reload || state === 'booting') {
				return;
			}
			clearLiveReloadTimer();
			live_reload_timer = setTimeout(function () {
				live_reload_timer = null;
				run({ kind: 'request', method: 'GET', path: '/', body: '' });
			}, LIVE_RELOAD_DEBOUNCE_MS);
		}

		async function run(target) {
			await boot();
			if (!bundle) {
				await loadBundle();
			}

			current_request = target && target.kind === 'request'
				? Object.assign({}, target, {
					path: normalizeRequestPath(target.path, payload_base_url)
				})
				: null;
			if (current_request) {
				current_request.responseUrl = resolveResponseUrl(current_request.path);
			}
			if (!current_request) {
				send_tenant_command({ type: 'clear', message: 'Running Lua…' });
			}

			setState('running');
			message_id += 1;
			const id = message_id;
			return new Promise(function (resolve) {
				pending_runs.set(id, resolve);
				const worker_target = current_request || target || { kind: 'request', method: 'GET', path: '/', body: '' };
				const message = {
					type: 'run',
					id: id,
					files: bundleFiles(),
					target: worker_target
				};
				const sources = currentSources();
				if (sources) {
					message.sources = sources;
				}
				post(message);
			});
		}

		async function refresh() {
			clearLiveReloadTimer();
			bundle = null;
			// Don't clear files here - loadBundle() will seed missing files from
			// bundle.sources while preserving any in-flight edits.
			await loadBundle();
			return run({ kind: 'request', method: 'GET', path: '/', body: '' });
		}

		// IDE-style live update: mutate in-memory files immediately, schedule
		// debounced live run. No HTTP, no disk, no draft overlay.
		function updateCode(path, contents) {
			files.set(path, contents);
			// Schedule live run regardless of bundle state. If bundle isn't loaded
			// yet, run() will load it first (and preserve this edit via loadBundle).
			scheduleLiveRun();
			return Promise.resolve(true);
		}

		// Reads the current canonical content for a file (in-memory edit if any,
		// else the last loaded bundle source), so callers can switch the active
		// file client-side without a server round trip. Returns null if the
		// path is unknown or the bundle hasn't loaded yet.
		function getFile(path) {
			if (files.has(path)) {
				return files.get(path);
			}
			if (bundle && bundle.sources && Object.prototype.hasOwnProperty.call(bundle.sources, path)) {
				return bundle.sources[path];
			}
			return null;
		}

		function setLiveReload(enabled) {
			live_reload = enabled !== false;
			if (!live_reload) {
				clearLiveReloadTimer();
			}
		}

		function handleTenantRequest(request) {
			void run({
				kind: 'request',
				requestId: request.requestId,
				method: request.method || 'GET',
				path: normalizeRequestPath(request.path || '/', payload_base_url),
				body: request.body || ''
			});
		}

		function dispose() {
			clearLiveReloadTimer();
			worker?.terminate();
			worker = null;
			boot_promise = null;
			bundle = null;
			pending_runs.clear();
			files.clear();
			current_request = null;
			setState('idle');
		}

		return {
			boot: boot,
			run: run,
			refresh: refresh,
			updateCode: updateCode,
			getFile: getFile,
			setLiveReload: setLiveReload,
			handleTenantRequest: handleTenantRequest,
			dispose: dispose,
			get state() {
				return state;
			}
		};
	}

	window.FuwaRuntimeSession = { create: create };
})();
