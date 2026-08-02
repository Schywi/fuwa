'use strict';

let terminals = {};
let eventSource = null;
let mounted = false;
let filterErrorsOnly = false;

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

function connectMux(containersByName) {
	if (typeof EventSource !== 'function') {
		Object.values(containersByName).forEach(function (t) {
			t.term.writeln('\x1b[1;31mSSE not supported\x1b[0m');
			setSlotStatus(t.slot, 'error');
		});
		return;
	}

	const names = Object.keys(containersByName);
	const params = names.map(function (name) {
		return 'name=' + encodeURIComponent(name);
	});
	if (filterErrorsOnly) {
		params.push('errors_only=1');
	}
	const url = '/__dev/containers/live?' + params.join('&');

	eventSource = new EventSource(url);

	eventSource.addEventListener('ready', function () {
		log('stream ready');
	});

	eventSource.addEventListener('status', function (event) {
		try {
			const msg = JSON.parse(event.data);
			const name = msg.container;
			if (!name || !containersByName[name]) return;
			const terminal = containersByName[name];
			const status = msg.status || '';
			if (status === 'connecting') {
				setSlotStatus(terminal.slot, 'connecting');
				terminal.term.writeln('\x1b[1;33mconnecting...\x1b[0m');
			} else if (status === 'connected') {
				setSlotStatus(terminal.slot, 'connected');
				terminal.term.writeln('\x1b[1;32mconnected\x1b[0m');
			} else if (status === 'closed' || status === 'done') {
				setSlotStatus(terminal.slot, 'disconnected');
			}
		} catch (_) {}
	});

	eventSource.addEventListener('log', function (event) {
		try {
			const msg = JSON.parse(event.data);
			const name = msg.container;
			if (!name || !containersByName[name]) return;
			const line = msg.line || '';
			containersByName[name].term.writeln(line);
		} catch (_) {}
	});

	eventSource.addEventListener('error', function (event) {
		try {
			const msg = JSON.parse(event.data);
			const name = msg.container;
			if (!name || !containersByName[name]) return;
			const terminal = containersByName[name];
			setSlotStatus(terminal.slot, 'error');
			terminal.term.writeln('\x1b[1;31m' + (msg.message || 'error') + '\x1b[0m');
		} catch (_) {}
	});

	eventSource.onerror = function () {
		Object.values(containersByName).forEach(function (terminal) {
			setSlotStatus(terminal.slot, 'disconnected');
		});
	};
}

export function mountAll() {
	if (mounted) return;
	const slots = document.querySelectorAll('[data-tmux-root]');
	if (slots.length === 0) return;

	import('/vendor/xterm/xterm-6.0.0.mjs').then(function (mod) {
		const Terminal = mod.Terminal;
		const containersByName = {};

		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			const label = slot.getAttribute('data-tmux-label') || 'term';
			const container = slot.getAttribute('data-tmux-container') || label;
			slot.textContent = '';

			const term = new Terminal({
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
	}).catch(function (error) {
		console.error('[shell:tmux] failed to load xterm', error);
	});
}

export function unmountAll() {
	if (eventSource) {
		try { eventSource.close(); } catch (error) {}
		eventSource = null;
	}
	Object.values(terminals).forEach(function (terminal) {
		try { terminal.term.dispose(); } catch (error) {}
	});
	terminals = {};
	mounted = false;
	filterErrorsOnly = false;
	log('unmounted');
}

export function toggleFilter() {
	filterErrorsOnly = !filterErrorsOnly;
	const button = document.querySelector('[data-tmux-filter-btn]');
	if (button) {
		button.textContent = filterErrorsOnly ? 'Errors only ✓' : 'Errors only';
		button.setAttribute('data-active', filterErrorsOnly ? 'true' : 'false');
	}
	if (!mounted) return;
	if (eventSource) {
		try { eventSource.close(); } catch (error) {}
		eventSource = null;
	}
	Object.values(terminals).forEach(function (terminal) {
		terminal.term.clear();
		setSlotStatus(terminal.slot, 'connecting');
	});
	connectMux(terminals);
}

document.addEventListener('click', function (event) {
	const button = event.target.closest('[data-tmux-filter-btn]');
	if (button) {
		toggleFilter();
	}
});
