(function () {
	'use strict';

	// The shell swaps #shell-content with htmx, so remount on every swap.
	const ROOT_SELECTOR = '[data-editor-root]';
	const mounted_roots = new WeakMap();
	let codemirror_modules = null;

	function loadCodeMirror() {
		if (!codemirror_modules) {
			codemirror_modules = Promise.all([import('@codemirror/state'), import('@codemirror/view')]).then(
				function ([state_module, view_module]) {
					return {
						EditorState: state_module.EditorState,
						EditorView: view_module.EditorView
					};
				}
			);
		}

		return codemirror_modules;
	}

	function findTextarea(root) {
		const form = root.closest('form');
		if (!(form instanceof HTMLFormElement)) {
			return null;
		}

		const textarea = form.querySelector('textarea[name="contents"]');
		return textarea instanceof HTMLTextAreaElement ? textarea : null;
	}

	async function mount(root) {
		if (!(root instanceof Element)) {
			return null;
		}

		const existing = mounted_roots.get(root);
		if (existing) {
			return existing;
		}

		const textarea = findTextarea(root);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			root.setAttribute('data-widget-state', 'error');
			return null;
		}

		const host = document.createElement('div');
		host.style.height = '100%';
		root.replaceChildren(host);

		try {
			const { EditorState, EditorView } = await loadCodeMirror();
			const syncTextarea = function (view) {
				textarea.value = view.state.doc.toString();
			};
			const editor_view = new EditorView({
				state: EditorState.create({
					doc: textarea.value,
					extensions: [
						EditorView.lineWrapping,
						EditorView.updateListener.of(function (update) {
							if (update.docChanged) {
								syncTextarea(update.view);
							}
						}),
						EditorView.theme(
							{
								'&': {
									height: '100%',
									backgroundColor: '#fdfcf9',
									color: '#1f2937',
									fontSize: '14px',
									lineHeight: '1.55'
								},
								'.cm-content': {
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
									padding: '16px'
								},
								'.cm-scroller': {
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
								},
								'.cm-focused': {
									outline: 'none'
								}
							},
							{ dark: false }
						)
					]
				}),
				parent: host
			});
			const form = textarea.form;
			const handleSubmit = function () {
				syncTextarea(editor_view);
			};

			if (form instanceof HTMLFormElement) {
				form.addEventListener('submit', handleSubmit);
			}

			textarea.hidden = true;
			textarea.setAttribute('aria-hidden', 'true');
			root.setAttribute('data-widget-state', 'mounted');
			root.setAttribute('data-widget-kind', 'editor');

			const cleanup = function () {
				if (form instanceof HTMLFormElement) {
					form.removeEventListener('submit', handleSubmit);
				}
				editor_view.destroy();
				textarea.hidden = false;
				textarea.removeAttribute('aria-hidden');
				root.removeAttribute('data-widget-state');
				root.removeAttribute('data-widget-kind');
				mounted_roots.delete(root);
			};

			mounted_roots.set(root, cleanup);
			return cleanup;
		} catch (error) {
			root.setAttribute('data-widget-state', 'error');
			root.setAttribute('data-widget-kind', 'editor');
			root.textContent = 'CodeMirror failed to load: ' + String(error && error.message ? error.message : error);

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

	window.FuwaShellEditor = {
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
