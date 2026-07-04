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
	const LUA_KEYWORDS = new Set([
		'and',
		'break',
		'do',
		'else',
		'elseif',
		'end',
		'false',
		'for',
		'function',
		'if',
		'in',
		'local',
		'nil',
		'not',
		'or',
		'repeat',
		'return',
		'then',
		'true',
		'until',
		'while'
	]);
	const LUA_BUILTINS = new Set([
		'assert',
		'error',
		'ipairs',
		'next',
		'pairs',
		'pcall',
		'print',
		'require',
		'select',
		'setmetatable',
		'tonumber',
		'tostring',
		'type',
		'getmetatable'
	]);

	function isWordStart(char) {
		return /[A-Za-z_]/.test(char);
	}

	function isWordChar(char) {
		return /[A-Za-z0-9_]/.test(char);
	}

	function readLongBracket(text, start) {
		if (text.charAt(start) !== '[') {
			return -1;
		}

		let index = start + 1;
		while (text.charAt(index) === '=') {
			index += 1;
		}
		if (text.charAt(index) !== '[') {
			return -1;
		}

		const delimiter = ']' + '='.repeat(index - start - 1) + ']';
		const end = text.indexOf(delimiter, index + 1);
		return end === -1 ? text.length : end + delimiter.length;
	}

	function readQuotedString(text, start) {
		const quote = text.charAt(start);
		let index = start + 1;
		while (index < text.length) {
			const char = text.charAt(index);
			if (char === '\\') {
				index += 2;
				continue;
			}
			if (char === quote) {
				return index + 1;
			}
			if (char === '\n' || char === '\r') {
				return index;
			}
			index += 1;
		}

		return text.length;
	}

	function readNumber(text, start) {
		let index = start;
		if (text.charAt(index) === '0' && (text.charAt(index + 1) === 'x' || text.charAt(index + 1) === 'X')) {
			index += 2;
			while (/[0-9a-fA-F_.]/.test(text.charAt(index))) {
				index += 1;
			}
			return index;
		}

		while (/[0-9_]/.test(text.charAt(index))) {
			index += 1;
		}
		if (text.charAt(index) === '.' && /[0-9]/.test(text.charAt(index + 1))) {
			index += 1;
			while (/[0-9_]/.test(text.charAt(index))) {
				index += 1;
			}
		}
		if (text.charAt(index) === 'e' || text.charAt(index) === 'E') {
			index += 1;
			if (text.charAt(index) === '+' || text.charAt(index) === '-') {
				index += 1;
			}
			while (/[0-9_]/.test(text.charAt(index))) {
				index += 1;
			}
		}

		return index;
	}

	function buildLuaHighlights(view, Decoration, RangeSetBuilder) {
		const text = view.state.doc.toString();
		const builder = new RangeSetBuilder();
		let index = 0;

		function mark(className, from, to) {
			if (to > from) {
				builder.add(from, to, Decoration.mark({ class: className }));
			}
		}

		while (index < text.length) {
			const char = text.charAt(index);
			const next = text.charAt(index + 1);

			if (char === '-' && next === '-') {
				if (text.charAt(index + 2) === '[') {
					const longEnd = readLongBracket(text, index + 2);
					if (longEnd > index + 2) {
						mark('cm-lua-comment', index, longEnd);
						index = longEnd;
						continue;
					}
				}
				let lineEnd = text.indexOf('\n', index + 2);
				if (lineEnd === -1) {
					lineEnd = text.length;
				}
				mark('cm-lua-comment', index, lineEnd);
				index = lineEnd;
				continue;
			}

			if (char === '"' || char === "'") {
				const end = readQuotedString(text, index);
				mark('cm-lua-string', index, end);
				index = end;
				continue;
			}

			if (char === '[') {
				const longEnd = readLongBracket(text, index);
				if (longEnd > index + 1) {
					mark('cm-lua-string', index, longEnd);
					index = longEnd;
					continue;
				}
			}

			if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next))) {
				const end = readNumber(text, index);
				mark('cm-lua-number', index, end);
				index = end;
				continue;
			}

			if (isWordStart(char)) {
				let end = index + 1;
				while (isWordChar(text.charAt(end))) {
					end += 1;
				}
				const word = text.slice(index, end);
				if (LUA_KEYWORDS.has(word)) {
					mark('cm-lua-keyword', index, end);
				} else if (LUA_BUILTINS.has(word)) {
					mark('cm-lua-builtin', index, end);
				}
				index = end;
				continue;
			}

			index += 1;
		}

		return builder.finish();
	}

	function loadCodeMirror() {
		if (!codemirror_modules) {
			codemirror_modules = Promise.all([import('@codemirror/state'), import('@codemirror/view')]).then(function ([
				state_module,
				view_module
			]) {
				return {
					EditorState: state_module.EditorState,
					RangeSetBuilder: state_module.RangeSetBuilder,
					EditorView: view_module.EditorView,
					Decoration: view_module.Decoration,
					ViewPlugin: view_module.ViewPlugin,
					drawSelection: view_module.drawSelection,
					dropCursor: view_module.dropCursor,
					highlightActiveLine: view_module.highlightActiveLine,
					highlightActiveLineGutter: view_module.highlightActiveLineGutter,
					highlightSpecialChars: view_module.highlightSpecialChars,
					lineNumbers: view_module.lineNumbers
				};
			});
		}

		return codemirror_modules;
	}

	function findContentsField(root) {
		const form = root.closest('form');
		if (!(form instanceof HTMLFormElement)) {
			return null;
		}

		const field = form.querySelector('input[name="contents"]');
		return field instanceof HTMLInputElement ? field : null;
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

		const contents_field = findContentsField(root);
		if (!(contents_field instanceof HTMLInputElement)) {
			root.setAttribute('data-widget-state', 'error');
			return null;
		}

		const file_path = root.getAttribute('data-file-path') || '';
		const server_contents = contents_field.value;
		const pending = pending_edits.get(file_path);
		const initial_doc = typeof pending === 'string' && pending !== server_contents ? pending : server_contents;
		if (initial_doc !== server_contents) {
			contents_field.value = initial_doc;
			root.setAttribute('data-editor-dirty', 'true');
		}

		const host = document.createElement('div');
		host.style.cssText = 'width:100%;height:100%;min-height:0;display:flex;flex-direction:column;';
		root.replaceChildren(host);

		try {
			const {
				EditorState,
				EditorView,
				Decoration,
				ViewPlugin,
				RangeSetBuilder,
				drawSelection,
				dropCursor,
				highlightActiveLine,
				highlightActiveLineGutter,
				highlightSpecialChars,
				lineNumbers
			} = await loadCodeMirror();
			const luaHighlightPlugin = ViewPlugin.fromClass(
				class {
					constructor(view) {
						this.decorations = buildLuaHighlights(view, Decoration, RangeSetBuilder);
					}

					update(update) {
						if (update.docChanged) {
							this.decorations = buildLuaHighlights(update.view, Decoration, RangeSetBuilder);
						}
					}
				},
				{
					decorations: (plugin) => plugin.decorations
				}
			);
			const syncContentsField = function (view) {
				const contents = view.state.doc.toString();
				contents_field.value = contents;
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
						lineNumbers(),
						highlightSpecialChars(),
						drawSelection(),
						dropCursor(),
						highlightActiveLineGutter(),
						highlightActiveLine(),
						luaHighlightPlugin,
						EditorView.lineWrapping,
						EditorView.updateListener.of(function (update) {
							if (update.docChanged) {
								syncContentsField(update.view);
							}
						}),
						EditorView.theme(
							{
								'&': {
									height: '100%',
									backgroundColor: '#1a1b26',
									color: '#c0caf5',
									fontSize: '13px',
									lineHeight: '1.55',
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
								},
								'.cm-editor': {
									height: '100%'
								},
								'.cm-content': {
									fontFamily: 'inherit',
									padding: '14px 0',
									caretColor: '#c0caf5'
								},
								'.cm-scroller': {
									fontFamily: 'inherit'
								},
								'.cm-gutters': {
									backgroundColor: '#16161e',
									color: '#565f89',
									border: 'none',
									paddingRight: '6px'
								},
								'.cm-activeLine': {
									backgroundColor: '#24283b'
								},
								'.cm-activeLineGutter': {
									backgroundColor: '#24283b',
									color: '#7aa2f7'
								},
								'.cm-focused': {
									outline: 'none'
								},
								'.cm-cursor': {
									borderLeftColor: '#c0caf5'
								},
								'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
									backgroundColor: '#33467c !important'
								},
								'.cm-lua-keyword': {
									color: '#bb9af7',
									fontWeight: '700'
								},
								'.cm-lua-builtin': {
									color: '#7aa2f7'
								},
								'.cm-lua-string': {
									color: '#9ece6a'
								},
								'.cm-lua-number': {
									color: '#ff9e64'
								},
								'.cm-lua-comment': {
									color: '#565f89',
									fontStyle: 'italic'
								}
							},
							{ dark: true }
						)
					]
				}),
				parent: host
			});
			const form = contents_field.form;
			const handleSubmit = function () {
				contents_field.value = editor_view.state.doc.toString();
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

			root.setAttribute('data-widget-state', 'mounted');
			root.setAttribute('data-widget-kind', 'editor');

			const cleanup = function () {
				if (form instanceof HTMLFormElement) {
					form.removeEventListener('submit', handleSubmit);
				}
				root.removeEventListener('keydown', handleKeydown);
				editor_view.destroy();
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
