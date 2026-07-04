(function () {
	'use strict';

	// Workspace chrome: petite-vue owns popover state, this hook only supplies
	// the tiny imperative seams that templates cannot express well: outside
	// clicks, search filtering, and keyboard focus within the rendered list.

	let active_state = null;

	function workspaceRoot(node) {
		return node instanceof Element ? node.closest('[data-workspace]') : null;
	}

	function currentRows(popover) {
		return Array.from(popover.querySelectorAll('[data-file-path]')).filter(function (row) {
			return !row.hidden;
		});
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
		return currentRows(popover).findIndex(function (row) {
			return row.dataset.focused === 'true';
		});
	}

	function syncPopoverUi(workspace, name) {
		if (!(workspace instanceof Element)) {
			return;
		}

		const popover = workspace.querySelector('[data-popover="' + name + '"]');
		if (!popover) {
			return;
		}

		const search = popover.querySelector('[data-popover-search]');
		if (search instanceof HTMLInputElement) {
			search.value = '';
			applyFilter(popover, '');
			search.focus();
			return;
		}

		focusRow(
			popover,
			currentRows(popover).findIndex(function (row) {
				return row.dataset.selected === 'true';
			})
		);
	}

	function createState() {
		return {
			open_popover: null,
			root: null,
			togglePopover(name, event) {
				const workspace = workspaceRoot(event && event.currentTarget);
				if (!(workspace instanceof Element)) {
					return;
				}

				this.root = workspace;
				if (this.open_popover === name) {
					this.closePopover();
					return;
				}

				this.open_popover = name;
				active_state = this;
				queueMicrotask(function () {
					syncPopoverUi(workspace, name);
				});
			},
			closePopover() {
				this.open_popover = null;
				if (active_state === this) {
					active_state = null;
				}
				if (!(this.root instanceof Element)) {
					return;
				}
				for (const row of this.root.querySelectorAll('[data-file-path]')) {
					row.removeAttribute('data-focused');
				}
			}
		};
	}

	function setView(workspace, view) {
		if (active_state && active_state.root === workspace) {
			active_state.closePopover();
		}

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

		const viewToggle = target.closest('[data-view-toggle]');
		if (viewToggle) {
			const workspace = workspaceRoot(viewToggle);
			if (!workspace) {
				return;
			}
			const next = workspace.getAttribute('data-active-view') === 'terminal' ? 'code' : 'terminal';
			setView(workspace, next);
		}
	});

	document.addEventListener(
		'pointerdown',
		function (event) {
			if (event.button !== 0) {
				return;
			}

			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}

			const workspace = active_state && active_state.root instanceof Element ? active_state.root : null;
			if (!workspace) {
				return;
			}

			if (target.closest('[data-popover]') || target.closest('[data-popover-toggle]')) {
				return;
			}

			if (!workspace.contains(target)) {
				active_state.closePopover();
				return;
			}

			active_state.closePopover();
		},
		true
	);

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
			active_state?.closePopover();
			return;
		}

		const target = event.target instanceof Element ? event.target : null;
		const popover = target ? target.closest('[data-popover]') : null;
		if (!popover) {
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
		createState,
		setView,
		initialize
	};

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			function () {
				initialize(document);
			},
			{ once: true }
		);
	} else {
		initialize(document);
	}

	document.addEventListener('htmx:afterSwap', function (event) {
		active_state = null;
		initialize(event.detail?.target || document);
	});
})();
