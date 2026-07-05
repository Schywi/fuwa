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
