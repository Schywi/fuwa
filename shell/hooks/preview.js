(function () {
	'use strict';

	// Browser-only preview controller.
	//
	// This owns the browser runtime driver lifecycle and forwards editor changes
	// directly into the in-memory Wasmoon session. The legacy server/draft path
	// is intentionally not part of the default shell anymore.

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

	function updateStatusPill(state) {
		const pill = document.getElementById('ide-runtime-state');
		if (!pill) {
			return;
		}
		pill.textContent = 'wasm · ' + state;
	}

	function clearLegacyPreviewFrame(stage) {
		if (!(stage instanceof Element)) {
			return;
		}

		const legacy_frame = stage.querySelector('iframe.shell-preview-frame:not([data-host-slot="runtime"])');
		if (legacy_frame) {
			legacy_frame.remove();
		}
	}

	function createBrowserDriver() {
		const stage = previewStage();
		if (!stage || !window.FuwaPreviewBrowserDriver) {
			log('runtime:create:blocked');
			return null;
		}

		clearLegacyPreviewFrame(stage);
		return window.FuwaPreviewBrowserDriver.create({
			stage: stage,
			writeTerminal: writeTerminal,
			log: log,
			onStatus: updateStatusPill
		});
	}

	function mountBrowserDriver() {
		const stage = previewStage();
		if (!stage) {
			log('runtime:stage:missing');
			return Promise.resolve(false);
		}

		if (browser_driver) {
			browser_driver.dispose();
			browser_driver = null;
		}

		browser_driver = createBrowserDriver();
		if (!browser_driver) {
			return Promise.resolve(false);
		}

		log('runtime:mount', { payloadId: payloadId() });
		return browser_driver
			.mount()
			.then(function (ok) {
				if (!ok) {
					log('runtime:mount:failed');
					browser_driver?.dispose();
					browser_driver = null;
					return false;
				}

				const pendingEdits = window.FuwaShellEditor && window.FuwaShellEditor.pendingEdits;
				if (pendingEdits && typeof pendingEdits.forEach === 'function') {
					let replay = Promise.resolve();
					pendingEdits.forEach(function (contents, path) {
						replay = replay.then(function () {
							return browser_driver ? browser_driver.updateCode(path, contents) : false;
						});
					});
					return replay.then(function () {
						return true;
					});
				}

				return true;
			})
			.catch(function (error) {
				log('runtime:mount:error', { message: String(error && error.message ? error.message : error) });
				writeTerminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
				return false;
			});
	}

	function refreshBrowserDriver() {
		if (!browser_driver) {
			return mountBrowserDriver();
		}

		return browser_driver.refresh().catch(function (error) {
			log('runtime:refresh:error', { message: String(error && error.message ? error.message : error) });
			writeTerminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
			return false;
		});
	}

	function updateBrowserCode(path, contents) {
		if (!browser_driver) {
			return mountBrowserDriver().then(function (ok) {
				if (!ok || !browser_driver) {
					return false;
				}
				return browser_driver.updateCode(path, contents).catch(function (error) {
					log('runtime:update-code:error', { message: String(error && error.message ? error.message : error) });
					writeTerminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
					return false;
				});
			});
		}

		return browser_driver.updateCode(path, contents).catch(function (error) {
			log('runtime:update-code:error', { message: String(error && error.message ? error.message : error) });
			writeTerminal('[runtime] ' + String(error && error.message ? error.message : error) + '\r\n');
			return false;
		});
	}

	function handleEditorChange(event) {
		const detail = event.detail || {};
		if (typeof detail.path !== 'string' || detail.path === '') {
			return;
		}

		void updateBrowserCode(detail.path, detail.contents || '');
	}

	// File selection must update session state, not rebuild the shell or hit
	// the server (the /IDE contract: setActiveFile only touches client state).
	// The session already holds every file's content in memory after boot, so
	// switching files can read from it directly instead of an hx-get fetch.
	function resolveFileContents(path) {
		const pending_edits = window.FuwaShellEditor && window.FuwaShellEditor.pendingEdits;
		if (pending_edits && pending_edits.has(path)) {
			return pending_edits.get(path);
		}
		const session = browser_driver && browser_driver.session;
		if (session && typeof session.getFile === 'function') {
			return session.getFile(path);
		}
		return null;
	}

	function updateSelectionMarkers(path) {
		for (const row of document.querySelectorAll('[data-popover] [data-file-path]')) {
			row.setAttribute('data-selected', row.getAttribute('data-file-path') === path ? 'true' : 'false');
		}
		const stat = document.getElementById('ide-entry-stat');
		if (stat) {
			stat.textContent = path;
		}
		const crumb = document.querySelector('.breadcrumb-segment[data-active="true"]');
		if (crumb) {
			crumb.textContent = path;
		}
		const workspace = document.querySelector('[data-workspace]');
		if (workspace) {
			workspace.setAttribute('data-selected-file', path);
		}
	}

	function handleFileRowClick(event) {
		const target = event.target instanceof Element ? event.target : null;
		const row = target ? target.closest('[data-popover] [data-file-path]') : null;
		if (!row) {
			return;
		}

		const path = row.getAttribute('data-file-path') || '';
		if (path === '') {
			return;
		}

		const contents = resolveFileContents(path);
		if (contents === null || contents === undefined) {
			// Runtime session isn't booted/loaded yet: fall back to the server
			// round trip (hx-get on the row) rather than showing nothing.
			log('file-switch:fallback-to-server', { path: path });
			return;
		}

		event.preventDefault();
		event.stopImmediatePropagation();

		const editor_root = document.querySelector('[data-editor-root]');
		if (editor_root && window.FuwaShellEditor && typeof window.FuwaShellEditor.switchFile === 'function') {
			window.FuwaShellEditor.switchFile(editor_root, path, contents);
		}
		updateSelectionMarkers(path);
		if (window.FuwaShellWorkspace?.state && typeof window.FuwaShellWorkspace.state.closePopover === 'function') {
			window.FuwaShellWorkspace.state.closePopover('file-select');
		}
		log('file-switch:client-side', { path: path });
	}

	function handleBeforeSwap(event) {
		const target = event.detail?.target || event.detail?.elt || event.target || document.body;
		log('htmx:beforeSwap', {
			target: target instanceof Element ? target.id || target.tagName.toLowerCase() : null
		});

		if (!(target instanceof Element) || target.id !== 'shell-content') {
			return;
		}

		browser_driver?.dispose();
		browser_driver = null;
	}

	function handleAfterSwap(event) {
		const target = event.detail?.target || event.detail?.elt || event.target || document.body;
		log('htmx:afterSwap', {
			target: target instanceof Element ? target.id || target.tagName.toLowerCase() : null
		});

		if (!(target instanceof Element) || target.id !== 'shell-content') {
			return;
		}

		void mountBrowserDriver();
	}

	document.addEventListener('fuwa:editor-change', handleEditorChange);
	document.addEventListener('htmx:beforeSwap', handleBeforeSwap);
	document.addEventListener('htmx:afterSwap', handleAfterSwap);
	// Capture phase: run before htmx's own bubble-phase click listener on the
	// row so a resolved client-side switch can suppress the hx-get entirely.
	document.addEventListener('click', handleFileRowClick, true);

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			function () {
				log('boot:DOMContentLoaded');
				void mountBrowserDriver();
			},
			{ once: true }
		);
	} else {
		log('boot:ready');
		void mountBrowserDriver();
	}

	window.FuwaShellPreview = {
		mode: function () {
			return 'browser';
		},
		refresh: refreshBrowserDriver,
		updateCode: updateBrowserCode,
		mount: mountBrowserDriver,
		get browserDriver() {
			return browser_driver;
		}
	};
})();
