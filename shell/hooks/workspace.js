(function () {
	'use strict';

	// Workspace chrome: petite-vue owns popover state, this hook only supplies
	// the tiny imperative seams that templates cannot express well: outside
	// clicks, search filtering, and keyboard focus within the rendered list.

	const LOG_PREFIX = '[shell:workspace]';
	let booted = false;
	let retry_timer = null;
	let workspace_state = null;
	let active_state = null;
	let mounted_app = null;
	const mounted_roots = new WeakSet();

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	function describeScope(scope) {
		if (!(scope instanceof Element)) {
			return null;
		}

		return {
			tag: scope.tagName.toLowerCase(),
			id: scope.id || null,
			activeView: scope.getAttribute('data-active-view') || null,
			hasScope: scope.hasAttribute('v-scope')
		};
	}

	function workspaceRoot(node) {
		return node instanceof Element ? node.closest('[data-workspace]') : null;
	}

	function resolveScope(scope, reason) {
		if (scope instanceof Element && document.contains(scope)) {
			return scope;
		}

		if (scope instanceof Element) {
			log(reason + ':fallback-document-body', describeScope(scope));
		}

		return document.body || document;
	}

	function rememberMounted(target) {
		if (!(target instanceof Element)) {
			return;
		}

		mounted_roots.add(target);
		for (const workspace of target.querySelectorAll('[data-workspace]')) {
			mounted_roots.add(workspace);
		}
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
		if (workspace_state) {
			return workspace_state;
		}

		workspace_state = {
			open_popover: null,
			root: null,
			togglePopover(name, event) {
				const workspace = workspaceRoot(event && event.currentTarget);
				if (!(workspace instanceof Element)) {
					log('popover-toggle:missing-workspace', { name: name });
					return;
				}

				log('popover-toggle:start', {
					name: name,
					open: this.open_popover,
					workspace: describeScope(workspace)
				});
				this.root = workspace;
				active_state = this;
				if (this.open_popover === name) {
					log('popover-toggle:close-self', { name: name });
					this.closePopover('toggle');
					return;
				}

				this.open_popover = name;
				log('popover-toggle:open', { name: name });
				queueMicrotask(function () {
					log('popover-toggle:sync-ui', { name: name });
					syncPopoverUi(workspace, name);
				});
			},
			closePopover(reason) {
				log('popover-close', {
					reason: reason || 'manual',
					open: this.open_popover,
					workspace: describeScope(this.root)
				});
				this.open_popover = null;
				if (active_state === this) {
					active_state = null;
				}
				if (!(this.root instanceof Element)) {
					this.root = null;
					return;
				}
				for (const row of this.root.querySelectorAll('[data-file-path]')) {
					row.removeAttribute('data-focused');
				}
				this.root = null;
			}
		};

		return workspace_state;
	}

	function setView(workspace, view) {
		if (active_state && active_state.root === workspace) {
			log('view-switch:close-active-popover', { view: view, workspace: describeScope(workspace) });
			active_state.closePopover();
		}

		// Cleanup previous obs view
		var prev = workspace.getAttribute('data-active-view');
		if (prev === 'obs' && window.FuwaShellObservability) {
			var prevObsRoot = workspace.querySelector('[data-obs-root]');
			if (prevObsRoot) {
				window.FuwaShellObservability.unmount(prevObsRoot);
			}
		}

		log('view-switch', {
			view: view,
			workspace: describeScope(workspace)
		});
		for (const panel of workspace.querySelectorAll('[data-view]')) {
			panel.hidden = panel.dataset.view !== view;
		}

		for (const btn of workspace.querySelectorAll('[data-view-toggle]')) {
			btn.setAttribute('data-view-active', btn.dataset.viewTarget === view ? 'true' : 'false');
		}

		if (view === 'terminal' && window.FuwaShellTerminal) {
			window.FuwaShellTerminal.refresh(workspace);
		}

		if (view === 'obs' && window.FuwaShellObservability) {
			var obsRoot = workspace.querySelector('[data-obs-root]');
			if (obsRoot) {
				window.FuwaShellObservability.mount(obsRoot);
			}
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
				log('view-toggle:missing-workspace');
				return;
			}
			const next = viewToggle.dataset.viewTarget || 'code';
			log('view-toggle:click', { next: next, workspace: describeScope(workspace) });
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
				log('outside-click:no-active-popover');
				return;
			}

			if (target.closest('[data-popover]') || target.closest('[data-popover-toggle]')) {
				log('outside-click:ignored-inside-popover', {
					target: target.tagName.toLowerCase()
				});
				return;
			}

			if (!workspace.contains(target)) {
				log('outside-click:close-popover', { workspace: describeScope(workspace) });
				active_state.closePopover('outside-click');
				return;
			}

			log('outside-click:close-popover-in-workspace', { workspace: describeScope(workspace) });
			active_state.closePopover('workspace-click');
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
		const target = resolveScope(scope, 'initialize');
		let workspace_count = 0;
		for (const workspace of target.querySelectorAll('[data-workspace]')) {
			workspace_count += 1;
			if (!workspace.hasAttribute('data-active-view')) {
				setView(workspace, 'code');
			}
		}
		if (target instanceof Element && target.matches('[data-workspace]') && !target.hasAttribute('data-active-view')) {
			setView(target, 'code');
		}
		log('initialize', { scope: describeScope(target), workspaces: workspace_count });
	}

	function dependenciesReady() {
		return window.PetiteVue && typeof window.PetiteVue.createApp === 'function';
	}

	function mount(scope) {
		const target = resolveScope(scope, 'mount');
		if (!(target instanceof Element)) {
			return;
		}

		if (mounted_roots.has(target)) {
			log('mount:already-mounted', describeScope(target));
			return;
		}

		if (window.PetiteVue && typeof window.PetiteVue.createApp === 'function') {
			try {
				log('mount:start', describeScope(target));
				if (mounted_app) {
					mounted_app.unmount();
				}
				mounted_app = window.PetiteVue.createApp({ scope: workspace_state }).mount(target);
				rememberMounted(target);
				log('mount:complete', describeScope(target));
			} catch (error) {
				console.error(LOG_PREFIX + ' petite-vue mount failed', error);
			}
		}
	}

	function boot() {
		log('boot:start');
		const shell = document.querySelector('.ide-shell') || document.body || document;
		initialize(shell);

		if (!dependenciesReady()) {
			if (!retry_timer) {
				log('boot:waiting-for-dependencies');
				retry_timer = setTimeout(function () {
					retry_timer = null;
					boot();
				}, 16);
			}
			return;
		}

		if (booted) {
			return;
		}

		booted = true;
		log('boot:mount-shell', describeScope(shell));
		mount(shell);
	}

	workspace_state = createState();

	window.FuwaShellWorkspace = {
		createState,
		state: workspace_state,
		setView,
		initialize
	};

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			function () {
				boot();
			},
			{ once: true }
		);
	} else {
		boot();
	}

	document.addEventListener('htmx:afterSwap', function (event) {
		const raw_scope = event.detail?.target || event.detail?.elt || event.target || document.body;
		if (raw_scope instanceof Element && (raw_scope.id === 'shell-content' || raw_scope.matches('[data-workspace]'))) {
			active_state?.closePopover('swap');
		}

		const target = raw_scope instanceof Element && raw_scope.id === 'shell-content'
			? document.querySelector('.ide-shell') || document.body || document
			: document.querySelector('[data-workspace]') || document.querySelector('.ide-shell') || document.body || document;
		active_state = workspace_state;
		log('afterSwap', {
			raw: describeScope(raw_scope),
			resolved: describeScope(target)
		});
		initialize(target);
		mount(target);
	});
})();
