(function () {
	'use strict';

	// Streams Kubernetes pod logs into the tmux panel. Each slot declares a
	// label selector; the backend (/__dev/pods/live) resolves it to a pod and
	// tails that pod's log through the cluster API.
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

	function connectMux(slotsById) {
		if (typeof EventSource !== 'function') {
			Object.values(slotsById).forEach(function (t) {
				t.term.writeln('\x1b[1;31mSSE not supported\x1b[0m');
				setSlotStatus(t.slot, 'error');
			});
			return;
		}

		var params = [];
		Object.keys(slotsById).forEach(function (id) {
			params.push('slot=' + encodeURIComponent(id));
			params.push('selector=' + encodeURIComponent(slotsById[id].selector || ''));
		});
		if (filterErrorsOnly) {
			params.push('errors_only=1');
		}
		var url = '/__dev/pods/live?' + params.join('&');

		eventSource = new EventSource(url);

		eventSource.addEventListener('ready', function (e) {
			log('stream ready');
		});

		eventSource.addEventListener('status', function (e) {
			try {
				var msg = JSON.parse(e.data);
				var t = msg.slot && slotsById[msg.slot];
				if (!t) return;
				var status = msg.status || '';
				if (status === 'connecting') {
					setSlotStatus(t.slot, 'connecting');
					t.term.writeln('\x1b[1;33mwaiting for pod…\x1b[0m');
				} else if (status === 'connected') {
					setSlotStatus(t.slot, 'connected');
					t.term.writeln('\x1b[1;32mconnected: ' + (msg.pod || '') + '\x1b[0m');
				} else if (status === 'closed' || status === 'done') {
					setSlotStatus(t.slot, 'disconnected');
					t.term.writeln('\x1b[1;33mpod log closed; reconnecting…\x1b[0m');
				}
			} catch (_) {}
		});

		eventSource.addEventListener('log', function (e) {
			try {
				var msg = JSON.parse(e.data);
				var t = msg.slot && slotsById[msg.slot];
				if (!t) return;
				t.term.writeln(msg.line || '');
			} catch (_) {}
		});

		eventSource.addEventListener('error', function (e) {
			if (!e || !e.data) return;
			try {
				var msg = JSON.parse(e.data);
				var t = msg.slot && slotsById[msg.slot];
				if (!t) return;
				setSlotStatus(t.slot, 'error');
				t.term.writeln('\x1b[1;31m' + (msg.message || 'error') + '\x1b[0m');
			} catch (_) {}
		});

		eventSource.onerror = function () {
			Object.values(slotsById).forEach(function (t) {
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
			var slotsById = {};

			for (var i = 0; i < slots.length; i++) {
				var slot = slots[i];
				var label = slot.getAttribute('data-tmux-label') || 'term';
				var id = slot.getAttribute('data-tmux-slot') || label;
				var selector = slot.getAttribute('data-tmux-selector') || '';
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
				slotsById[id] = { term: term, label: label, slot: slot, selector: selector };
			}

			terminals = slotsById;
			mounted = true;

			connectMux(slotsById);
			log('mounted ' + Object.keys(slotsById).length + ' terminals');
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
			btn.textContent = filterErrorsOnly ? 'Errors only ✓' : 'Errors only';
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
