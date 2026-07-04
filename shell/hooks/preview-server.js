(function () {
	'use strict';

	// Server-runtime preview driver: the route-backed iframe rendered by the
	// host. The iframe node is owned by the server HTML; this driver only
	// reloads its content and toggles visibility, never recreates it.

	function create(context) {
		const stage = context.stage;
		const log = context.log || function () {};

		function frame() {
			return stage ? stage.querySelector('iframe.shell-preview-frame:not([data-host-slot="runtime"])') : null;
		}

		function refresh() {
			const current = frame();
			if (!current || !current.contentWindow) {
				log('server:refresh:no-frame');
				return;
			}
			try {
				current.contentWindow.location.reload();
			} catch (error) {
				// Cross-origin fallback: re-assign src without replacing the node.
				current.src = current.getAttribute('src');
			}
		}

		function setSource(url) {
			const current = frame();
			if (!current) {
				return;
			}
			if (current.getAttribute('src') === url) {
				refresh();
				return;
			}
			current.src = url;
		}

		function show() {
			const current = frame();
			if (current) {
				current.style.display = '';
			}
		}

		function hide() {
			const current = frame();
			if (current) {
				current.style.display = 'none';
			}
		}

		function dispose() {
			show();
		}

		return {
			kind: 'server',
			frame: frame,
			refresh: refresh,
			setSource: setSource,
			show: show,
			hide: hide,
			dispose: dispose
		};
	}

	window.FuwaPreviewServerDriver = { create: create };
})();
