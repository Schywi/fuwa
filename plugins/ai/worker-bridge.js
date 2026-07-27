(function () {
	'use strict';

	// AI execution bridge: sends Lua snippets to the Wasmoon worker and
	// returns captured stdout + serialized return values.  Used by chat.js
	// when the AI wants to inspect runtime state (loaded modules, DB rows,
	// VFS contents, etc.).
	//
	// Public API:
	//   window.FuwaAI.exec(code) → Promise<{stdout: string[], result: any}>

	var LOG_PREFIX = '[shell:ai-bridge]';
	var pending_requests = {};
	var request_counter = 0;

	function log(msg, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX, msg);
		} else {
			console.info(LOG_PREFIX, msg, detail);
		}
		window.FuwaObservability && window.FuwaObservability.log('shell:ai-bridge', msg, detail);
	}

	function getSession() {
		// Access the runtime session through the preview driver
		var preview = window.FuwaShellPreview;
		if (!preview) {
			return null;
		}
		var driver = preview.browserDriver;
		if (!driver) {
			return null;
		}
		return driver.session;
	}

	function exec(code) {
		return new Promise(function (resolve, reject) {
			var session = getSession();
			if (!session) {
				reject(new Error('Runtime session is not booted. Open a preview first.'));
				return;
			}

			var worker = session.worker;
			if (!worker) {
				reject(new Error('Worker is not available. The session may not be booted yet.'));
				return;
			}

			request_counter += 1;
			var id = request_counter;

			var timeout = setTimeout(function () {
				worker.removeEventListener('message', listener);
				delete pending_requests[id];
				reject(new Error('ai_exec timed out after 30s'));
			}, 30000);

			function listener(event) {
				var message = event.data;
				if (!message || message.__fuwaBrowser !== true || message.id !== id) {
					return;
				}

				if (message.type === 'ai_done') {
					clearTimeout(timeout);
					worker.removeEventListener('message', listener);
					delete pending_requests[id];

					var result = null;
					if (message.result != null) {
						try {
							result = JSON.parse(message.result);
						} catch (e) {
							result = message.result;
						}
					}

					resolve({
						stdout: message.stdout || [],
						result: result,
					});
					return;
				}

				if (message.type === 'ai_error') {
					clearTimeout(timeout);
					worker.removeEventListener('message', listener);
					delete pending_requests[id];
					reject(new Error(message.error || 'Unknown ai_exec error'));
				}
			}

			pending_requests[id] = { resolve: resolve, reject: reject, timeout: timeout };
			worker.addEventListener('message', listener);

			session.post({
				type: 'ai_exec',
				id: id,
				code: code,
			});
		});
	}

	window.FuwaAI = {
		exec: exec,
	};
})();
