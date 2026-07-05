(function () {
	'use strict';

	// Browser-runtime preview driver: owns the Wasmoon runtime session, the
	// tenant iframe (/runtime/tenant.html), and the host<->tenant command
	// relay (__fuwaTenant ping/ready/request/stream, ordered command queue).

	function create(context) {
		const stage = context.stage;
		const write_terminal = context.writeTerminal || function () {};
		const on_status = context.onStatus || function () {};
		const log = context.log || function () {};

		let session = null;
		let runtime_iframe = null;
		let tenant_ready = false;
		let ready_probe = null;
		let command_id = 0;
		let sent_command_id = 0;
		const command_queue = [];

		function postToTenant(command) {
			log('tenant:post', { command: command });
			runtime_iframe?.contentWindow?.postMessage(
				{ __fuwaTenant: true, type: 'command', command: command },
				'*'
			);
		}

		function flushCommands() {
			if (!tenant_ready) {
				log('tenant:flush:queued', { queued: command_queue.length, sent: sent_command_id });
				return;
			}
			for (const entry of command_queue) {
				if (entry.id <= sent_command_id) {
					continue;
				}
				postToTenant(entry.command);
				sent_command_id = entry.id;
			}
		}

		function queueTenantCommand(command) {
			command_id += 1;
			command_queue.push({ id: command_id, command: command });
			log('tenant:queue', { id: command_id, queued: command_queue.length });
			if (command_queue.length > 40) {
				command_queue.splice(0, command_queue.length - 40);
			}
			flushCommands();
		}

		function stopReadyProbe() {
			if (ready_probe) {
				clearInterval(ready_probe);
				ready_probe = null;
			}
		}

		function startReadyProbe() {
			stopReadyProbe();
			const probe = function () {
				log('tenant:probe-ping');
				runtime_iframe?.contentWindow?.postMessage({ __fuwaTenant: true, type: 'ping' }, '*');
			};
			probe();
			ready_probe = setInterval(function () {
				if (tenant_ready) {
					stopReadyProbe();
					return;
				}
				probe();
			}, 150);
		}

		function handleMessage(event) {
			if (!runtime_iframe || event.source !== runtime_iframe.contentWindow) {
				return;
			}
			const message = event.data;
			if (!message || message.__fuwaTenant !== true) {
				return;
			}

			if (message.type === 'ready') {
				log('tenant:ready');
				tenant_ready = true;
				stopReadyProbe();
				flushCommands();
				return;
			}

			if (message.type === 'request' && session) {
				log('tenant:request', { kind: message.request?.kind || null });
				session.handleTenantRequest(message);
				return;
			}

			if (message.type === 'stream' && message.stream === 'log') {
				log('tenant:log', { text: message.text });
				write_terminal('[tenant:log] ' + message.text + '\r\n');
			}
		}

		function ensureSession() {
			if (session || !window.FuwaRuntimeSession || !stage) {
				return session;
			}
			session = window.FuwaRuntimeSession.create({
				workerUrl: stage.getAttribute('data-runtime-worker-url'),
				bundleUrl: stage.getAttribute('data-bundle-url'),
				onTerminal: write_terminal,
				onStatus: on_status,
				sendTenantCommand: queueTenantCommand
			});
			log('runtime:session-created', {
				workerUrl: stage.getAttribute('data-runtime-worker-url'),
				bundleUrl: stage.getAttribute('data-bundle-url')
			});
			return session;
		}

		function refresh() {
			if (!session) {
				return Promise.resolve(false);
			}
			return session.refresh().catch(function (error) {
				log('runtime:refresh:error', { message: String(error && error.message ? error.message : error) });
				write_terminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
				return false;
			});
		}

		// IDE-style live update: update in-memory file and let session debounce.
		function updateCode(path, contents) {
			if (!session || typeof session.updateCode !== 'function') {
				return refresh();
			}
			return session.updateCode(path, contents).catch(function (error) {
				log('runtime:update-code:error', { message: String(error && error.message ? error.message : error) });
				write_terminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
				return false;
			});
		}

		function mount() {
			if (!stage || !ensureSession()) {
				log('runtime:mount:blocked');
				return Promise.resolve(false);
			}

			tenant_ready = false;
			sent_command_id = 0;
			command_queue.length = 0;

			window.addEventListener('message', handleMessage);

			runtime_iframe = document.createElement('iframe');
			runtime_iframe.className = 'shell-preview-frame';
			runtime_iframe.setAttribute('data-host-slot', 'runtime');
			runtime_iframe.setAttribute('title', 'Browser runtime tenant');
			runtime_iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
			runtime_iframe.src = stage.getAttribute('data-runtime-tenant-url') || '/runtime/tenant.html';
			runtime_iframe.addEventListener('load', function () {
				tenant_ready = false;
				startReadyProbe();
			});
			stage.appendChild(runtime_iframe);

			return refresh().then(function () {
				return true;
			});
		}

		function dispose() {
			stopReadyProbe();
			tenant_ready = false;
			window.removeEventListener('message', handleMessage);
			runtime_iframe?.remove();
			runtime_iframe = null;
			session?.dispose();
			session = null;
			command_queue.length = 0;
			sent_command_id = 0;
		}

		return {
			kind: 'browser',
			mount: mount,
			refresh: refresh,
			updateCode: updateCode,
			dispose: dispose,
			get session() {
				return session;
			}
		};
	}

	window.FuwaPreviewBrowserDriver = { create: create };
})();
