(function () {
	'use strict';

	// Preview mode controller. The two runtimes are separate drivers:
	//
	//   preview-server.js  — route-backed iframe (server compiles per request)
	//   preview-browser.js — Wasmoon worker + tenant iframe bridge
	//
	// This file only owns mode state, the non-destructive refresh token
	// (#ide-preview-refresh, OOB-updated by saves), and teardown on payload
	// switches. It is the only code that knows two modes exist.

	let last_refresh_token = '';
	let runtime_mode = 'server';
	let server_driver = null;
	let browser_driver = null;
	const LOG_PREFIX = '[shell:preview]';

	function previewStage() {
		return document.querySelector('[data-preview-stage]');
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

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	function serverDriver() {
		if (!server_driver && window.FuwaPreviewServerDriver) {
			server_driver = window.FuwaPreviewServerDriver.create({
				stage: previewStage(),
				log: log
			});
		}
		return server_driver;
	}

	function activeDriver() {
		return runtime_mode === 'browser' ? browser_driver : serverDriver();
	}

	// --- runtime mode switch --------------------------------------------------

	function enterBrowserMode() {
		const stage = previewStage();
		if (!stage || !window.FuwaPreviewBrowserDriver) {
			log('runtime:enter-browser:blocked');
			return;
		}

		log('runtime:enter-browser', { payloadId: payloadId() });
		browser_driver = window.FuwaPreviewBrowserDriver.create({
			stage: stage,
			writeTerminal: writeTerminal,
			log: log,
			onStatus: function (state) {
				const pill = document.getElementById('ide-runtime-state');
				if (pill && runtime_mode === 'browser') {
					pill.textContent = 'wasm · ' + state;
				}
			}
		});

		if (!browser_driver.mount()) {
			browser_driver = null;
			return;
		}
		runtime_mode = 'browser';
		serverDriver()?.hide();
	}

	function exitBrowserMode() {
		log('runtime:exit-browser', { payloadId: payloadId() });
		runtime_mode = 'server';
		browser_driver?.dispose();
		browser_driver = null;
		serverDriver()?.show();
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
			log('refresh-token:missing');
			return;
		}

		const token = marker.getAttribute('data-refresh-token') || '';
		if (token === '' || token === last_refresh_token) {
			log('refresh-token:unchanged', { token: token });
			return;
		}
		last_refresh_token = token;
		log('refresh-token:updated', { token: token, mode: runtime_mode });

		activeDriver()?.refresh();
	}

	document.addEventListener('htmx:afterSwap', checkRefreshToken);
	document.addEventListener('htmx:oobAfterSwap', checkRefreshToken);

	// A full #shell-content swap (payload switch) replaces the preview island;
	// tear the browser runtime down so the new payload starts clean, and drop
	// the cached server driver because its stage node is gone.
	document.addEventListener('htmx:beforeSwap', function (event) {
		const target = event.detail?.target;
		log('htmx:beforeSwap', { target: target instanceof Element ? target.id || target.tagName.toLowerCase() : null });
		if (!(target instanceof Element) || target.id !== 'shell-content') {
			return;
		}
		if (runtime_mode === 'browser') {
			exitBrowserMode();
		}
		server_driver = null;
		last_refresh_token = '';
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
