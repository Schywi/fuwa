(function () {
	'use strict';

	// Preview orchestration. Two responsibilities:
	//
	// 1. Non-destructive refresh: save responses OOB-update
	//    #ide-preview-refresh with a new token; we reload the mounted tenant
	//    document (or re-run the browser runtime) without recreating the
	//    preview iframe. Unrelated workspace swaps never touch the iframe.
	//
	// 2. Runtime mode: the preview can run route-backed (server compiles and
	//    renders per request) or in-browser (Wasmoon worker + SQLite-WASM via
	//    FuwaRuntimeSession, bridged to a srcdoc-equivalent tenant document).

	let last_refresh_token = '';
	let runtime_mode = 'server';
	let session = null;
	let runtime_iframe = null;
	let tenant_ready = false;
	let ready_probe = null;
	let command_id = 0;
	let sent_command_id = 0;
	const command_queue = [];

	function previewStage() {
		return document.querySelector('[data-preview-stage]');
	}

	function routeIframe() {
		const stage = previewStage();
		return stage ? stage.querySelector('iframe.shell-preview-frame') : null;
	}

	function payloadId() {
		const stage = previewStage();
		return stage ? stage.getAttribute('data-payload-id') || 'current' : 'current';
	}

	function writeTerminal(text) {
		if (window.FuwaShellTerminal) {
			window.FuwaShellTerminal.write(payloadId(), text);
		}
	}

	// --- tenant bridge (browser runtime) ------------------------------------

	function postToTenant(command) {
		runtime_iframe?.contentWindow?.postMessage(
			{ __fuwaTenant: true, type: 'command', command: command },
			'*'
		);
	}

	function flushCommands() {
		if (!tenant_ready) {
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

	window.addEventListener('message', function (event) {
		if (!runtime_iframe || event.source !== runtime_iframe.contentWindow) {
			return;
		}
		const message = event.data;
		if (!message || message.__fuwaTenant !== true) {
			return;
		}

		if (message.type === 'ready') {
			tenant_ready = true;
			stopReadyProbe();
			flushCommands();
			return;
		}

		if (message.type === 'request' && session) {
			session.handleTenantRequest(message);
			return;
		}

		if (message.type === 'stream' && message.stream === 'log') {
			writeTerminal('[tenant:log] ' + message.text + '\r\n');
		}
	});

	// --- runtime mode switch --------------------------------------------------

	function ensureSession() {
		if (session || !window.FuwaRuntimeSession) {
			return session;
		}
		const stage = previewStage();
		if (!stage) {
			return null;
		}

		session = window.FuwaRuntimeSession.create({
			workerUrl: stage.getAttribute('data-runtime-worker-url'),
			bundleUrl: stage.getAttribute('data-bundle-url'),
			onTerminal: writeTerminal,
			onStatus: function (state) {
				const pill = document.getElementById('ide-runtime-state');
				if (pill && runtime_mode === 'browser') {
					pill.textContent = 'wasm · ' + state;
				}
			},
			sendTenantCommand: queueTenantCommand
		});
		return session;
	}

	function enterBrowserMode() {
		const stage = previewStage();
		const route_frame = routeIframe();
		if (!stage || !ensureSession()) {
			return;
		}

		runtime_mode = 'browser';
		tenant_ready = false;
		sent_command_id = 0;
		command_queue.length = 0;

		if (route_frame) {
			route_frame.style.display = 'none';
		}

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

		void session.refresh().catch(function (error) {
			writeTerminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
		});
	}

	function exitBrowserMode() {
		runtime_mode = 'server';
		stopReadyProbe();
		tenant_ready = false;
		runtime_iframe?.remove();
		runtime_iframe = null;
		session?.dispose();
		session = null;
		const route_frame = routeIframe();
		if (route_frame) {
			route_frame.style.display = '';
		}
	}

	function updateModeButton(button) {
		const label = button.querySelector('[data-runtime-mode-label]');
		const meta = button.querySelector('.shell-button-meta');
		button.setAttribute('data-runtime-mode', runtime_mode);
		if (label) {
			label.textContent = runtime_mode === 'browser' ? 'Browser runtime' : 'Server runtime';
		}
		if (meta) {
			meta.textContent = runtime_mode === 'browser' ? 'Wasmoon + SQLite-WASM' : 'tap to run in-browser';
		}
	}

	document.addEventListener('click', function (event) {
		const target = event.target instanceof Element ? event.target : null;
		const button = target ? target.closest('[data-runtime-mode-toggle]') : null;
		if (!button) {
			return;
		}

		if (runtime_mode === 'server') {
			enterBrowserMode();
		} else {
			exitBrowserMode();
		}
		updateModeButton(button);
	});

	// --- non-destructive refresh ----------------------------------------------

	function checkRefreshToken() {
		const marker = document.getElementById('ide-preview-refresh');
		if (!marker) {
			return;
		}

		const token = marker.getAttribute('data-refresh-token') || '';
		if (token === '' || token === last_refresh_token) {
			return;
		}
		last_refresh_token = token;

		if (runtime_mode === 'browser' && session) {
			void session.refresh().catch(function (error) {
				writeTerminal('[runtime] refresh failed: ' + String(error && error.message ? error.message : error) + '\r\n');
			});
			return;
		}

		const frame = routeIframe();
		if (frame && frame.contentWindow) {
			try {
				frame.contentWindow.location.reload();
			} catch (error) {
				// Cross-origin fallback: re-assign src without replacing the node.
				frame.src = frame.getAttribute('src');
			}
		}
	}

	document.addEventListener('htmx:afterSwap', checkRefreshToken);
	document.addEventListener('htmx:oobAfterSwap', checkRefreshToken);

	// A full #shell-content swap (payload switch) replaces the preview island;
	// tear the browser runtime down so the new payload starts clean.
	document.addEventListener('htmx:beforeSwap', function (event) {
		const target = event.detail?.target;
		if (target instanceof Element && target.id === 'shell-content' && runtime_mode === 'browser') {
			exitBrowserMode();
		}
		if (target instanceof Element && target.id === 'shell-content') {
			last_refresh_token = '';
		}
	});

	window.FuwaShellPreview = {
		refreshToken: function () {
			return last_refresh_token;
		},
		mode: function () {
			return runtime_mode;
		}
	};
})();
