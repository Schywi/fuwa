(function () {
	'use strict';

	// The workspace fragment is swapped by htmx on file select and save, so the
	// editor remounts per swap. Unsaved edits are kept per file path in
	// pending_edits and restored on remount, mirroring the IDE runtime session
	// file-state behavior. Each edit also emits `fuwa:editor-change` so the
	// browser runtime session can schedule live reloads.
	const ROOT_SELECTOR = '[data-editor-root]';
	const mounted_roots = new WeakMap();
	const pending_edits = new Map();
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

	function emitChange(root, file_path, contents) {
		document.dispatchEvent(
			new CustomEvent('fuwa:editor-change', {
				detail: {
					path: file_path,
					contents: contents,
					root: root
				}
			})
		);
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

		const file_path = root.getAttribute('data-file-path') || '';
		const server_contents = textarea.value;
		const pending = pending_edits.get(file_path);
		const initial_doc = typeof pending === 'string' && pending !== server_contents ? pending : server_contents;
		if (initial_doc !== server_contents) {
			textarea.value = initial_doc;
			root.setAttribute('data-editor-dirty', 'true');
		}

		const host = document.createElement('div');
		host.style.height = '100%';
		root.replaceChildren(host);

		try {
			const { EditorState, EditorView } = await loadCodeMirror();
			const syncTextarea = function (view) {
				const contents = view.state.doc.toString();
				textarea.value = contents;
				if (contents === server_contents) {
					pending_edits.delete(file_path);
					root.removeAttribute('data-editor-dirty');
				} else {
					pending_edits.set(file_path, contents);
					root.setAttribute('data-editor-dirty', 'true');
				}
				emitChange(root, file_path, contents);
			};
			const editor_view = new EditorView({
				state: EditorState.create({
					doc: initial_doc,
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
				textarea.value = editor_view.state.doc.toString();
			};
			const handleKeydown = function (event) {
				if ((event.metaKey || event.ctrlKey) && event.key === 's') {
					event.preventDefault();
					handleSubmit();
					if (form instanceof HTMLFormElement) {
						if (window.htmx && typeof window.htmx.trigger === 'function') {
							window.htmx.trigger(form, 'submit');
						} else {
							form.requestSubmit();
						}
					}
				}
			};

			if (form instanceof HTMLFormElement) {
				form.addEventListener('submit', handleSubmit);
			}
			root.addEventListener('keydown', handleKeydown);

			textarea.hidden = true;
			textarea.setAttribute('aria-hidden', 'true');
			root.setAttribute('data-widget-state', 'mounted');
			root.setAttribute('data-widget-kind', 'editor');

			const cleanup = function () {
				if (form instanceof HTMLFormElement) {
					form.removeEventListener('submit', handleSubmit);
				}
				root.removeEventListener('keydown', handleKeydown);
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

	// A successful save means the server now owns the submitted contents;
	// drop the pending edit for that path so the next mount uses the response.
	document.addEventListener('htmx:beforeSwap', function (event) {
		const xhr = event.detail?.xhr;
		const source = event.detail?.requestConfig?.elt;
		if (!xhr || xhr.status !== 200 || !(source instanceof HTMLFormElement)) {
			return;
		}
		const path_input = source.querySelector('input[name="path"]');
		if (path_input instanceof HTMLInputElement) {
			pending_edits.delete(path_input.value);
		}
	});

	window.FuwaShellEditor = {
		mount,
		unmount,
		refresh,
		pendingEdits: pending_edits,
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
