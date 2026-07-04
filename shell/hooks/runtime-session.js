(function () {
	'use strict';

	// Host-side runtime session: the fuwa equivalent of the IDE RuntimeSession +
	// adapter pair. Owns the Wasmoon worker lifecycle, the compiled payload
	// bundle, the run/reset loop, live-reload scheduling, terminal streaming,
	// and the tenant command relay. The worker protocol lives in
	// runtime/browser/init.lua (contract) and shell/hooks/runtime-worker.js.

	function create(options) {
		const worker_url = options.workerUrl;
		const bundle_url = options.bundleUrl;
		const on_terminal = options.onTerminal || function () {};
		const on_status = options.onStatus || function () {};
		const send_tenant_command = options.sendTenantCommand || function () {};

		let worker = null;
		let state = 'idle';
		let boot_promise = null;
		let bundle = null;
		let message_id = 0;
		let live_timer = null;
		const pending_runs = new Map();
		const local_edits = new Map();
		let current_request = null;

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
				if (current_request && current_request.requestId != null) {
					send_tenant_command({
						type: 'reply',
						requestId: current_request.requestId,
						html: message.html,
						path: current_request.path,
						status: 200
					});
				} else {
					send_tenant_command({
						type: 'swap',
						html: message.html,
						path: current_request ? current_request.path : '/'
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
			const files = Object.assign({}, bundle ? bundle.files : {});
			for (const entry of local_edits) {
				files[entry[0]] = entry[1];
			}
			return files;
		}

		async function run(target) {
			await boot();
			if (!bundle) {
				await loadBundle();
			}

			current_request = target && target.kind === 'request' ? target : null;
			if (!current_request) {
				send_tenant_command({ type: 'clear', message: 'Running Lua…' });
			}

			setState('running');
			message_id += 1;
			const id = message_id;
			return new Promise(function (resolve) {
				pending_runs.set(id, resolve);
				post({
					type: 'run',
					id: id,
					files: bundleFiles(),
					target: target || { kind: 'request', method: 'GET', path: '/', body: '' }
				});
			});
		}

		async function refresh() {
			bundle = null;
			local_edits.clear();
			await loadBundle();
			return run({ kind: 'request', method: 'GET', path: '/', body: '' });
		}

		function handleTenantRequest(request) {
			void run({
				kind: 'request',
				requestId: request.requestId,
				method: request.method || 'GET',
				path: request.path || '/',
				body: request.body || ''
			});
		}

		function scheduleLiveRun() {
			if (state === 'booting' || state === 'idle') {
				return;
			}
			if (live_timer) {
				clearTimeout(live_timer);
			}
			live_timer = setTimeout(function () {
				live_timer = null;
				void run({ kind: 'request', method: 'GET', path: '/', body: '' });
			}, 650);
		}

		function updateLocalFile(path, contents) {
			// Live edits are raw .fuwa sources; the bundle holds compiled Lua, so
			// local edits only take effect through refresh() (a server compile).
			// Track them anyway so the session knows the workspace is dirty.
			local_edits.set(path, contents);
		}

		function dispose() {
			if (live_timer) {
				clearTimeout(live_timer);
				live_timer = null;
			}
			worker?.terminate();
			worker = null;
			boot_promise = null;
			bundle = null;
			pending_runs.clear();
			local_edits.clear();
			current_request = null;
			setState('idle');
		}

		return {
			boot: boot,
			run: run,
			refresh: refresh,
			handleTenantRequest: handleTenantRequest,
			scheduleLiveRun: scheduleLiveRun,
			updateLocalFile: updateLocalFile,
			dispose: dispose,
			get state() {
				return state;
			}
		};
	}

	window.FuwaRuntimeSession = { create: create };
})();
