(function () {
	'use strict';

	var terminals = {};
	var eventSource = null;
	var mounted = false;
	var filterErrorsOnly = false;

	function log(step, detail) {
		if (detail === undefined) {
			console.info('[shell:tmux] ' + step);
			return;
		}
		console.info('[shell:tmux] ' + step, detail);
	}

	function setSlotStatus(slot, status) {
		slot.setAttribute('data-tmux-status', status);
	}

	function isErrorLine(line) {
		var lower = line.toLowerCase();
		return lower.indexOf('error') !== -1
			|| lower.indexOf('warn') !== -1
			|| lower.indexOf('fail') !== -1
			|| lower.indexOf('fatal') !== -1
			|| lower.indexOf('panic') !== -1
			|| lower.indexOf('exception') !== -1
			|| lower.indexOf('traceback') !== -1;
	}

	function connectMux(containersByName) {
		if (typeof EventSource !== 'function') {
			Object.values(containersByName).forEach(function (t) {
				t.term.writeln('\x1b[1;31mSSE not supported\x1b[0m');
				setSlotStatus(t.slot, 'error');
			});
			return;
		}

		var names = Object.keys(containersByName);
		var params = names.map(function (n) {
			return 'name=' + encodeURIComponent(n);
		});
		if (filterErrorsOnly) {
			params.push('errors_only=1');
		}
		var url = '/__dev/containers/live?' + params.join('&');

		eventSource = new EventSource(url);

		eventSource.addEventListener('ready', function (e) {
			log('stream ready');
		});

		eventSource.addEventListener('status', function (e) {
			try {
				var msg = JSON.parse(e.data);
				var name = msg.container;
				if (!name || !containersByName[name]) return;
				var t = containersByName[name];
				var status = msg.status || '';
				if (status === 'connecting') {
					setSlotStatus(t.slot, 'connecting');
					t.term.writeln('\x1b[1;33mconnecting...\x1b[0m');
				} else if (status === 'connected') {
					setSlotStatus(t.slot, 'connected');
					t.term.writeln('\x1b[1;32mconnected\x1b[0m');
				} else if (status === 'closed' || status === 'done') {
					setSlotStatus(t.slot, 'disconnected');
				}
			} catch (_) {}
		});

		eventSource.addEventListener('log', function (e) {
			try {
				var msg = JSON.parse(e.data);
				var name = msg.container;
				if (!name || !containersByName[name]) return;
				var line = msg.line || '';
				containersByName[name].term.writeln(line);
			} catch (_) {}
		});

		eventSource.addEventListener('error', function (e) {
			try {
				var msg = JSON.parse(e.data);
				var name = msg.container;
				if (!name || !containersByName[name]) return;
				var t = containersByName[name];
				setSlotStatus(t.slot, 'error');
				t.term.writeln('\x1b[1;31m' + (msg.message || 'error') + '\x1b[0m');
			} catch (_) {}
		});

		eventSource.onerror = function () {
			Object.values(containersByName).forEach(function (t) {
				setSlotStatus(t.slot, 'disconnected');
			});
		};
	}

	function mountAll() {
		if (mounted) return;
		var slots = document.querySelectorAll('[data-tmux-root]');
		if (slots.length === 0) return;

		import('/vendor/xterm/xterm-6.0.0.mjs').then(function (mod) {
			var Terminal = mod.Terminal;
			var containersByName = {};

			for (var i = 0; i < slots.length; i++) {
				var slot = slots[i];
				var label = slot.getAttribute('data-tmux-label') || 'term';
				var container = slot.getAttribute('data-tmux-container') || label;
				slot.textContent = '';

				var term = new Terminal({
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					fontSize: 9,
					lineHeight: 1.2,
					cursorBlink: true,
					convertEol: true,
					theme: {
						background: '#09090b',
						foreground: '#c0caf5',
						cursor: '#b48cff'
					}
				});

				term.open(slot);
				containersByName[container] = { term: term, label: label, slot: slot };
			}

			terminals = containersByName;
			mounted = true;

			connectMux(containersByName);
			log('mounted ' + Object.keys(containersByName).length + ' terminals');
		}).catch(function (err) {
			console.error('[shell:tmux] failed to load xterm', err);
		});
	}

	function unmountAll() {
		if (eventSource) {
			try { eventSource.close(); } catch (e) {}
			eventSource = null;
		}
		Object.values(terminals).forEach(function (t) {
			try { t.term.dispose(); } catch (e) {}
		});
		terminals = {};
		mounted = false;
		filterErrorsOnly = false;
		log('unmounted');
	}

	function toggleFilter() {
		filterErrorsOnly = !filterErrorsOnly;
		var btn = document.querySelector('[data-tmux-filter-btn]');
		if (btn) {
			btn.textContent = filterErrorsOnly ? 'errors only ✓' : 'errors only';
			btn.setAttribute('data-active', filterErrorsOnly ? 'true' : 'false');
		}
		if (!mounted) return;
		if (eventSource) {
			try { eventSource.close(); } catch (e) {}
			eventSource = null;
		}
		Object.values(terminals).forEach(function (t) {
			t.term.clear();
			setSlotStatus(t.slot, 'connecting');
		});
		connectMux(terminals);
	}

	document.addEventListener('click', function (e) {
		var btn = e.target.closest('[data-tmux-filter-btn]');
		if (btn) { toggleFilter(); }
	});

	window.FuwaShellTmux = {
		mountAll: mountAll,
		unmountAll: unmountAll,
		toggleFilter: toggleFilter
	};
})();
