(function () {
	'use strict';

	// Tmux panel: mounts xterm.js instances into each tmux-slot in the
	// bento grid. One terminal per container. Streams docker logs via SSE.

	var terminals = [];
	var eventSources = [];
	var mounted = false;

	function log(step, detail) {
		if (detail === undefined) {
			console.info('[shell:tmux] ' + step);
			return;
		}
		console.info('[shell:tmux] ' + step, detail);
	}

	function connectLogs(term, label) {
		if (typeof EventSource !== 'function') return;

		var es = new EventSource('/__dev/containers/' + label + '/logs');
		eventSources.push(es);

		es.addEventListener('message', function (e) {
			term.writeln(e.data);
		});

		es.addEventListener('error', function () {
			term.writeln('\x1b[1;31m[disconnected]\x1b[0m');
		});

		es.addEventListener('open', function () {
			term.writeln('\x1b[1;32m[connected]\x1b[0m');
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
				term.writeln('\x1b[1;35m' + label + '\x1b[0m');

				terminals.push({ term: term, label: label, slot: slot });

				// Connect SSE log stream
				connectLogs(term, container);
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
		log('unmounted');
	}

	// Mount when tmux panel opens
	document.addEventListener('htmx:afterSwap', function () {
		var panel = document.querySelector('.tmux-panel');
		if (panel && panel.offsetParent !== null) {
			mountAll();
		}
	});

	// Also check on first load
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () {
			var panel = document.querySelector('.tmux-panel');
			if (panel && panel.offsetParent !== null) mountAll();
		}, { once: true });
	}

	window.FuwaShellTmux = {
		mountAll: mountAll,
		unmountAll: unmountAll
	};
})();
