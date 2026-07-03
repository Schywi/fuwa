(function () {
	'use strict';

	// The terminal root remounts after shell fragment swaps, matching the editor hook.
	const ROOT_SELECTOR = '[data-terminal-root]';
	const mounted_roots = new WeakMap();
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
		const panel = root.closest('.shell-terminal');
		if (!(panel instanceof Element)) {
			return '';
		}

		const seed = panel.querySelector('[data-terminal-seed]');
		return seed instanceof Element ? seed.textContent || '' : '';
	}

	async function mount(root) {
		if (!(root instanceof Element)) {
			return null;
		}

		const existing = mounted_roots.get(root);
		if (existing) {
			return existing;
		}

		const host = document.createElement('div');
		host.style.height = '100%';
		root.replaceChildren(host);

		try {
			const { Terminal, FitAddon } = await loadTerminalModules();
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
			let resize_observer = null;

			terminal.loadAddon(fit_addon);
			terminal.open(host);
			fit_addon.fit();
			terminal.write(readSeed(root));

			if (typeof ResizeObserver === 'function') {
				resize_observer = new ResizeObserver(function () {
					fit_addon.fit();
				});
				resize_observer.observe(host);
			}

			root.setAttribute('data-widget-state', 'mounted');
			root.setAttribute('data-widget-kind', 'terminal');

			const cleanup = function () {
				resize_observer?.disconnect();
				fit_addon.dispose();
				terminal.dispose();
				root.removeAttribute('data-widget-state');
				root.removeAttribute('data-widget-kind');
				mounted_roots.delete(root);
			};

			mounted_roots.set(root, cleanup);
			return cleanup;
		} catch (error) {
			root.setAttribute('data-widget-state', 'error');
			root.setAttribute('data-widget-kind', 'terminal');
			root.textContent = 'xterm failed to load: ' + String(error && error.message ? error.message : error);

			const cleanup = function () {
				root.removeAttribute('data-widget-state');
				root.removeAttribute('data-widget-kind');
				mounted_roots.delete(root);
			};

			mounted_roots.set(root, cleanup);
			return cleanup;
		}
	}

	function unmount(root) {
		if (!(root instanceof Element)) {
			return;
		}

		const cleanup = mounted_roots.get(root);
		if (cleanup) {
			cleanup();
		}
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

	function clearRoots(scope) {
		const target = scope && typeof scope.querySelectorAll === 'function' ? scope : document.body || document;

		if (target instanceof Element && target.matches(ROOT_SELECTOR)) {
			unmount(target);
		}

		for (const root of target.querySelectorAll(ROOT_SELECTOR)) {
			unmount(root);
		}
	}

	function handleBeforeSwap(event) {
		clearRoots(event.detail?.target || event.detail?.elt || event.target || document.body);
	}

	function handleAfterSwap(event) {
		refresh(event.detail?.target || event.detail?.elt || event.target || document.body);
	}

	window.FuwaShellTerminal = {
		mount,
		unmount,
		refresh,
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
