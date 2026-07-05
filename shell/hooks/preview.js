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

	// --- draft live reload ------------------------------------------------------
	//
	// Edits never touch the payload source tree: they are debounced into
	// POST /draft/<id> (the .fuwa-dev/drafts overlay) and the preview re-renders
	// through the draft-aware surfaces (/preview/<id>/ or bundle.json?draft=1).
	// "Publish + run" remains the only path that writes real sources.

	// Short enough to feel like /IDE (near-instant after you stop typing),
	// long enough to coalesce a burst of keystrokes into one compile+run.
	const DRAFT_DEBOUNCE_MS = 200;
	const pending_drafts = new Map();
	let draft_timer = null;
	let draft_dirty = false;

	function setDraftDirty(dirty) {
		draft_dirty = dirty;
		const indicator = document.querySelector('[data-draft-indicator]');
		const discard = document.querySelector('[data-draft-discard]');
		if (indicator) {
			indicator.hidden = !dirty;
		}
		if (discard) {
			discard.hidden = !dirty;
		}
	}

	function refreshActiveDriver() {
		if (runtime_mode === 'browser') {
			browser_driver?.refresh();
			return;
		}
		const driver = serverDriver();
		if (driver) {
			driver.setSource('/preview/' + encodeURIComponent(payloadId()) + '/');
		}
	}

	function flushDrafts() {
		draft_timer = null;
		const entries = Array.from(pending_drafts.entries());
		pending_drafts.clear();
		if (entries.length === 0) {
			return;
		}

		// Browser mode gets instant feedback: the worker recompiles the edits
		// in-VM while the draft POST persists them concurrently. Server mode
		// waits for the POST, then re-renders through /preview/<id>/.
		if (runtime_mode === 'browser' && browser_driver) {
			const edits = {};
			for (const entry of entries) {
				edits[entry[0]] = entry[1];
			}
			browser_driver.liveUpdate(edits);
		}

		const id = encodeURIComponent(payloadId());
		const writes = entries.map(function (entry) {
			return fetch('/draft/' + id, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'path=' + encodeURIComponent(entry[0]) + '&contents=' + encodeURIComponent(entry[1])
			}).then(function (response) {
				if (!response.ok) {
					throw new Error('draft write failed: ' + response.status);
				}
			});
		});

		Promise.all(writes)
			.then(function () {
				log('draft:written', { files: entries.length });
				setDraftDirty(true);
				if (runtime_mode !== 'browser') {
					refreshActiveDriver();
				}
			})
			.catch(function (error) {
				log('draft:error', { message: String(error && error.message ? error.message : error) });
				writeTerminal('[draft] ' + String(error && error.message ? error.message : error) + '\r\n');
			});
	}

	document.addEventListener('fuwa:editor-change', function (event) {
		const detail = event.detail || {};
		if (typeof detail.path !== 'string' || detail.path === '') {
			return;
		}
		pending_drafts.set(detail.path, detail.contents || '');
		if (draft_timer) {
			clearTimeout(draft_timer);
		}
		draft_timer = setTimeout(flushDrafts, DRAFT_DEBOUNCE_MS);
	});

	document.addEventListener('click', function (event) {
		const target = event.target instanceof Element ? event.target : null;
		const button = target ? target.closest('[data-draft-discard]') : null;
		if (!button) {
			return;
		}

		pending_drafts.clear();
		if (draft_timer) {
			clearTimeout(draft_timer);
			draft_timer = null;
		}

		fetch('/draft/' + encodeURIComponent(payloadId()) + '/discard', { method: 'POST' })
			.then(function (response) {
				if (!response.ok) {
					throw new Error('draft discard failed: ' + response.status);
				}
				log('draft:discarded');
				setDraftDirty(false);
				refreshActiveDriver();
				if (window.FuwaShellEditor && window.FuwaShellEditor.pendingEdits) {
					window.FuwaShellEditor.pendingEdits.clear();
				}
			})
			.catch(function (error) {
				log('draft:discard:error', { message: String(error && error.message ? error.message : error) });
			});
	});

	// A successful publish re-renders the workspace (indicator returns hidden)
	// and clears the published file's draft copy server-side; reset local state
	// so the indicator does not immediately re-show from stale flags.
	document.addEventListener('htmx:afterSwap', function (event) {
		const target = event.detail?.target;
		if (target instanceof Element && target.id === 'ide-workspace') {
			setDraftDirty(draft_dirty && pending_drafts.size > 0);
		}
	});

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
