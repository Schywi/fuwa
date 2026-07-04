(function () {
	'use strict';

	// Workspace chrome: popovers, file search, keyboard selection, view toggle.
	// Everything is delegated on document so htmx swaps of #ide-workspace need
	// no rebinding and no teardown.

	function workspaceRoot(node) {
		return node instanceof Element ? node.closest('[data-workspace]') : null;
	}

	function closePopovers(scope) {
		const root = scope || document;
		for (const popover of root.querySelectorAll('[data-popover]')) {
			popover.hidden = true;
		}
		for (const toggle of root.querySelectorAll('[data-popover-toggle]')) {
			toggle.removeAttribute('data-open');
		}
	}

	function openPopover(workspace, name) {
		closePopovers(workspace);
		const popover = workspace.querySelector('[data-popover="' + name + '"]');
		const toggle = workspace.querySelector('[data-popover-toggle="' + name + '"]');
		if (!popover) {
			return;
		}

		popover.hidden = false;
		toggle?.setAttribute('data-open', 'true');

		const search = popover.querySelector('[data-popover-search]');
		if (search instanceof HTMLInputElement) {
			search.value = '';
			applyFilter(popover, '');
			search.focus();
		} else {
			focusRow(popover, currentRows(popover).findIndex((row) => row.dataset.selected === 'true'));
		}
	}

	function currentRows(popover) {
		return Array.from(popover.querySelectorAll('[data-file-path]')).filter((row) => !row.hidden);
	}

	function applyFilter(popover, query) {
		const needle = query.trim().toLowerCase();
		for (const row of popover.querySelectorAll('[data-file-path]')) {
			row.hidden = needle !== '' && !row.dataset.filePath.toLowerCase().includes(needle);
			row.removeAttribute('data-focused');
		}
	}

	function focusRow(popover, index) {
		const rows = currentRows(popover);
		if (rows.length === 0) {
			return;
		}

		const clamped = Math.max(0, Math.min(index < 0 ? 0 : index, rows.length - 1));
		for (const row of rows) {
			row.removeAttribute('data-focused');
		}
		rows[clamped].setAttribute('data-focused', 'true');
		rows[clamped].scrollIntoView({ block: 'nearest' });
	}

	function focusedIndex(popover) {
		return currentRows(popover).findIndex((row) => row.dataset.focused === 'true');
	}

	function setView(workspace, view) {
		for (const panel of workspace.querySelectorAll('[data-view]')) {
			panel.hidden = panel.dataset.view !== view;
		}

		const toggle = workspace.querySelector('[data-view-toggle]');
		if (toggle) {
			toggle.setAttribute('data-view-active', view === 'terminal' ? 'true' : 'false');
		}

		if (view === 'terminal' && window.FuwaShellTerminal) {
			window.FuwaShellTerminal.refresh(workspace);
		}

		workspace.setAttribute('data-active-view', view);
	}

	document.addEventListener('click', function (event) {
		const target = event.target instanceof Element ? event.target : null;
		if (!target) {
			return;
		}

		const toggle = target.closest('[data-popover-toggle]');
		if (toggle) {
			const workspace = workspaceRoot(toggle);
			if (!workspace) {
				return;
			}
			const name = toggle.dataset.popoverToggle;
			const popover = workspace.querySelector('[data-popover="' + name + '"]');
			if (popover && !popover.hidden) {
				closePopovers(workspace);
			} else {
				openPopover(workspace, name);
			}
			return;
		}

		const viewToggle = target.closest('[data-view-toggle]');
		if (viewToggle) {
			const workspace = workspaceRoot(viewToggle);
			if (!workspace) {
				return;
			}
			const next = workspace.getAttribute('data-active-view') === 'terminal' ? 'code' : 'terminal';
			setView(workspace, next);
			return;
		}

		if (target.closest('[data-file-path]')) {
			// htmx handles the request; the swap replaces the workspace and its
			// popovers, so no explicit close is needed.
			return;
		}

		if (!target.closest('.code-shell-header')) {
			closePopovers(document);
		}
	});

	document.addEventListener('input', function (event) {
		const input = event.target;
		if (!(input instanceof HTMLInputElement) || !input.matches('[data-popover-search]')) {
			return;
		}

		const popover = input.closest('[data-popover]');
		if (popover) {
			applyFilter(popover, input.value);
		}
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape') {
			closePopovers(document);
			return;
		}

		const target = event.target instanceof Element ? event.target : null;
		const popover = target ? target.closest('[data-popover]') : null;
		if (!popover || popover.hidden) {
			return;
		}

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			focusRow(popover, focusedIndex(popover) + delta);
			return;
		}

		if (event.key === 'Enter') {
			const rows = currentRows(popover);
			const focused = rows[focusedIndex(popover)] || rows[0];
			if (focused && target instanceof HTMLInputElement) {
				event.preventDefault();
				focused.click();
			}
		}
	});

	function initialize(scope) {
		const target = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
		for (const workspace of target.querySelectorAll('[data-workspace]')) {
			if (!workspace.hasAttribute('data-active-view')) {
				setView(workspace, 'code');
			}
		}
		if (target instanceof Element && target.matches('[data-workspace]') && !target.hasAttribute('data-active-view')) {
			setView(target, 'code');
		}
	}

	window.FuwaShellWorkspace = {
		setView,
		closePopovers,
		initialize
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () {
			initialize(document);
		}, { once: true });
	} else {
		initialize(document);
	}

	document.addEventListener('htmx:afterSwap', function (event) {
		initialize(event.detail?.target || document);
	});
})();
