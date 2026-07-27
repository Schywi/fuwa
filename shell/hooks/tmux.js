(function () {
	'use strict';

	var terminals = [];
	var eventSources = [];
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
		// status: 'connecting' | 'connected' | 'disconnected' | 'error'
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

	function connectLogs(term, container, slot) {
		if (typeof EventSource !== 'function') {
			term.writeln('\x1b[1;31mSSE not supported\x1b[0m');
			setSlotStatus(slot, 'error');
			return;
		}

		setSlotStatus(slot, 'connecting');
		term.writeln('\x1b[1;33mconnecting...\x1b[0m');

		var es = new EventSource('/__dev/containers/' + container + '/logs');
		eventSources.push(es);

		es.addEventListener('open', function () {
			setSlotStatus(slot, 'connected');
			term.writeln('\x1b[1;32mconnected\x1b[0m');
		});

		es.addEventListener('message', function (e) {
			var line = e.data;
			if (filterErrorsOnly && !isErrorLine(line)) return;
			term.writeln(line);
		});

		es.addEventListener('error', function () {
			setSlotStatus(slot, 'disconnected');
			term.writeln('\x1b[1;31mdisconnected\x1b[0m');
		});
	}

	function mountAll() {
		if (mounted) return;
		var slots = document.querySelectorAll('[data-tmux-root]');
		if (slots.length === 0) return;

		import('/vendor/xterm/xterm-6.0.0.mjs').then(function (mod) {
			var Terminal = mod.Terminal;

			for (var i = 0; i < slots.length; i++) {
				var slot = slots[i];
				var label = slot.getAttribute('data-tmux-label') || 'term';
				var container = slot.getAttribute('data-tmux-container') || label;
				slot.textContent = '';

				var term = new Terminal({
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					fontSize: 11,
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
				terminals.push({ term: term, label: label, container: container, slot: slot });

				setTimeout(function () {
					connectLogs(term, container, slot);
				}, i * 120);
			}

			mounted = true;
			log('mounted ' + terminals.length + ' terminals');
		}).catch(function (err) {
			console.error('[shell:tmux] failed to load xterm', err);
		});
	}

	function unmountAll() {
		for (var i = 0; i < eventSources.length; i++) {
			try { eventSources[i].close(); } catch (e) {}
		}
		eventSources = [];
		for (var j = 0; j < terminals.length; j++) {
			try { terminals[j].term.dispose(); } catch (e) {}
		}
		terminals = [];
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
