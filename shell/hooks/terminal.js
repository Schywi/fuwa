(function () {
	'use strict';

	// Terminal sessions outlive workspace fragment swaps. Each payload id owns
	// one xterm instance living in a detached container; mounting re-parents
	// the container instead of recreating the terminal, so scrollback survives
	// file switches and only new run output (tracked by data-terminal-run-id)
	// is appended.
	const ROOT_SELECTOR = '[data-terminal-root]';
	const sessions = new Map();
	let xterm_modules = null;

	function loadTerminalModules() {
		if (!xterm_modules) {
			xterm_modules = Promise.all([
				import('/vendor/xterm/xterm-6.0.0.mjs'),
				import('/vendor/xterm/addon-fit-0.11.0.mjs')
			]).then(function ([xterm_module, fit_module]) {
				return {
					Terminal: xterm_module.Terminal,
					FitAddon: fit_module.FitAddon
				};
			});
		}

		return xterm_modules;
	}

	function readSeed(root) {
		const panel = root.closest('[data-view="terminal"], .shell-terminal');
		if (!(panel instanceof Element)) {
			return '';
		}

		const seed = panel.querySelector('[data-terminal-seed]');
		return seed instanceof Element ? seed.textContent || '' : '';
	}

	async function ensureSession(session_id) {
		let session = sessions.get(session_id);
		if (session) {
			return session;
		}

		const { Terminal, FitAddon } = await loadTerminalModules();
		if (sessions.has(session_id)) {
			return sessions.get(session_id);
		}

		const container = document.createElement('div');
		container.style.height = '100%';
		const fit_addon = new FitAddon();
		const terminal = new Terminal({
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
			fontSize: 12,
			lineHeight: 1.25,
			cursorBlink: false,
			convertEol: true,
			theme: {
				background: '#09090b',
				foreground: '#f4f4f5',
				cursor: '#f59e0b',
				cursorAccent: '#09090b'
			}
		});

		terminal.loadAddon(fit_addon);
		terminal.open(container);

		session = {
			terminal,
			fit_addon,
			container,
			applied_run_ids: new Set(),
			resize_observer: null
		};

		if (typeof ResizeObserver === 'function') {
			session.resize_observer = new ResizeObserver(function () {
				if (container.isConnected) {
					try {
						fit_addon.fit();
					} catch (error) {
						/* fit can race detach; harmless */
					}
				}
			});
			session.resize_observer.observe(container);
		}

		sessions.set(session_id, session);
		return session;
	}

	function appendOutput(session, text) {
		if (text === '') {
			return;
		}
		session.terminal.write(text.endsWith('\n') ? text : text + '\n');
	}

	async function mount(root) {
		if (!(root instanceof Element)) {
			return null;
		}

		const session_id = root.getAttribute('data-terminal-session') || 'default';
		try {
			const session = await ensureSession(session_id);

			if (!session.container.isConnected || session.container.parentElement !== root) {
				root.replaceChildren(session.container);
				try {
					session.fit_addon.fit();
				} catch (error) {
					/* first fit after re-parent can race layout */
				}
			}

			const run_id = root.getAttribute('data-terminal-run-id') || 'idle';
			if (!session.applied_run_ids.has(run_id)) {
				session.applied_run_ids.add(run_id);
				appendOutput(session, readSeed(root));
			}

			root.setAttribute('data-widget-state', 'mounted');
			root.setAttribute('data-widget-kind', 'terminal');
			return session;
		} catch (error) {
			root.setAttribute('data-widget-state', 'error');
			root.setAttribute('data-widget-kind', 'terminal');
			root.textContent = 'xterm failed to load: ' + String(error && error.message ? error.message : error);
			return null;
		}
	}

	function detach(root) {
		if (!(root instanceof Element)) {
			return;
		}

		// Move the live container out of the subtree that htmx is about to
		// replace; the terminal instance stays alive for the next mount.
		for (const session of sessions.values()) {
			if (root.contains(session.container)) {
				session.container.remove();
			}
		}
	}

	function write(session_id, text) {
		const session = sessions.get(session_id);
		if (session) {
			session.terminal.write(text);
		}
	}

	function clear(session_id) {
		const session = sessions.get(session_id);
		if (session) {
			session.terminal.clear();
		}
	}

	function dispose(session_id) {
		const session = sessions.get(session_id);
		if (!session) {
			return;
		}

		session.resize_observer?.disconnect();
		session.fit_addon.dispose();
		session.terminal.dispose();
		session.container.remove();
		sessions.delete(session_id);
	}

	function refresh(scope) {
		const target = scope && typeof scope.querySelectorAll === 'function' ? scope : document.body || document;

		if (target instanceof Element && target.matches(ROOT_SELECTOR)) {
			void mount(target);
		}

		for (const root of target.querySelectorAll(ROOT_SELECTOR)) {
			void mount(root);
		}
	}

	function handleBeforeSwap(event) {
		const scope = event.detail?.target || event.detail?.elt || event.target || document.body;
		const target = scope && typeof scope.querySelectorAll === 'function' ? scope : document.body || document;

		if (target instanceof Element && target.matches(ROOT_SELECTOR)) {
			detach(target);
		}

		for (const root of target.querySelectorAll(ROOT_SELECTOR)) {
			detach(root);
		}
	}

	function handleAfterSwap(event) {
		refresh(event.detail?.target || event.detail?.elt || event.target || document.body);
	}

	window.FuwaShellTerminal = {
		mount,
		refresh,
		write,
		clear,
		dispose,
		selector: ROOT_SELECTOR
	};

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			function () {
				refresh(document.body || document);
			},
			{ once: true }
		);
	} else {
		refresh(document.body || document);
	}

	document.addEventListener('htmx:beforeSwap', handleBeforeSwap);
	document.addEventListener('htmx:afterSwap', handleAfterSwap);
})();
