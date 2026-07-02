(function () {
	'use strict';

	// The terminal root remounts after shell fragment swaps, matching the editor hook.
	const ROOT_SELECTOR = '[data-terminal-root]';
	const mounted_roots = new WeakMap();

	function mount(root) {
		if (!(root instanceof Element)) {
			return null;
		}

		const existing = mounted_roots.get(root);
		if (existing) {
			return existing;
		}

		root.setAttribute('data-widget-state', 'mounted');
		root.setAttribute('data-widget-kind', 'terminal');

		const cleanup = () => {
			root.removeAttribute('data-widget-state');
			root.removeAttribute('data-widget-kind');
			mounted_roots.delete(root);
		};

		mounted_roots.set(root, cleanup);
		return cleanup;
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
			mount(target);
		}

		for (const root of target.querySelectorAll(ROOT_SELECTOR)) {
			mount(root);
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
