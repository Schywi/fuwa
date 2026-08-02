// Data provider: payload source files from the editor.
// On-demand only — never auto-included. The classifier decides when to pull code.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	function readSources() {
		var editor = window.FuwaShellEditor;
		var files = {};
		if (editor && editor.pendingEdits instanceof Map) {
			editor.pendingEdits.forEach(function (content, path) { files[path] = content; });
		}
		var active_path = readActiveFilePath();
		var active_source = readActiveFileContents();
		if (active_path && typeof active_source === 'string' && active_source.length > 0) {
			files[active_path] = active_source;
		}
		return files;
	}

	function readEditorForm() {
		return document.getElementById('ide-editor-form');
	}

	function readActiveFilePath() {
		var form = readEditorForm();
		if (form) {
			var pathInput = form.querySelector('input[name="path"]');
			if (pathInput && pathInput.value) return pathInput.value;
		}
		return null;
	}

	function readActiveFileContents() {
		var form = readEditorForm();
		if (!form) return null;
		var contents = form.querySelector('input[name="contents"]');
		return contents && typeof contents.value === 'string' ? contents.value : null;
	}

	function trimChars(text, max_chars) {
		if (!text || !max_chars || text.length <= max_chars) return text;
		return text.slice(0, max_chars);
	}

	function readEditorSelection(max_chars) {
		var selection = window.getSelection ? window.getSelection() : null;
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
		var text = trimChars(selection.toString().trim(), max_chars);
		if (!text) return null;

		var form = readEditorForm();
		var root = form ? form.querySelector('[data-editor-root]') : null;
		var anchor = selection.anchorNode;
		var focus = selection.focusNode;
		if (!(root instanceof Element) || !anchor || !focus) return null;
		if (!root.contains(anchor) || !root.contains(focus)) return null;

		return {
			path: readActiveFilePath() || 'current',
			text: text
		};
	}

	function resolvePrimaryPath(path) {
		if (path && path !== 'current') return path;
		return readActiveFilePath();
	}

	function collectBoundedFile(path, max_lines, max_chars) {
		var target_path = resolvePrimaryPath(path);
		if (!target_path) return null;
		var files = readSources();
		var content = files[target_path];
		if (!content) return null;

		var lines = content.split('\n');
		var excerpt_lines = lines.slice(0, max_lines || lines.length);
		var excerpt = trimChars(excerpt_lines.join('\n'), max_chars);
		if (!excerpt) return null;

		return {
			type: 'source_excerpt',
			source: 'sources',
			items: [{
				path: target_path,
				start_line: 1,
				end_line: Math.min(excerpt_lines.length, lines.length),
				total_lines: lines.length,
				text: excerpt
			}]
		};
	}

	window.FuwaAITools.sources = {
		name: 'sources',
		describe: 'Read payload source files (on-demand only)',
		cost: '~300-1000 tokens per excerpt',
		always: false,
		triggers: ['explain', 'what does', 'how does', 'file', '.fuwa', '.lua', '/code'],

		// ── excerpt by path and line range ──────────────────────────

		collectExcerpt: function (path, start_line, end_line) {
			var files = readSources();
			var content = files[path];
			if (!content) {
				// Try to read from active file if path is null
				if (!path || path === 'current') {
					path = readActiveFilePath();
					if (path) content = files[path];
				}
				if (!content) return null;
			}

			var lines = content.split('\n');
			start_line = Math.max(1, start_line || 1);
			end_line = Math.min(lines.length, end_line || lines.length);
			var excerpt = lines.slice(start_line - 1, end_line).join('\n');

			return {
				type: 'source_excerpt',
				source: 'sources',
				items: [{
					path: path,
					start_line: start_line,
					end_line: end_line,
					total_lines: lines.length,
					text: excerpt
				}]
			};
		},

		collectSelection: function (options) {
			options = options || {};
			var selection = readEditorSelection(options.max_chars || 1200);
			if (!selection) return null;
			return {
				type: 'selected_text',
				source: 'sources',
				items: [selection]
			};
		},

		// ── active file only ────────────────────────────────────────

		collectActiveFile: function () {
			var path = readActiveFilePath();
			if (!path) return null;
			var files = readSources();
			var content = files[path];
			if (!content) return null;

			var lines = content.split('\n');
			return {
				type: 'active_file',
				source: 'sources',
				items: [{
					path: path,
					line_count: lines.length,
				}]
			};
		},

		collectPrimaryExcerpt: function (options) {
			options = options || {};
			return collectBoundedFile(options.path, options.max_lines || 80, options.max_chars || 2400);
		},

		// ── full file (rare, explicit only) ─────────────────────────

		collect: function () {
			var files = readSources();
			var active = readActiveFilePath();
			if (!active || !files[active]) return null;

			var content = files[active];
			var lines = content.split('\n');
			return {
				type: 'source_excerpt',
				source: 'sources',
				items: [{
					path: active,
					start_line: 1,
					end_line: lines.length,
					total_lines: lines.length,
					text: content
				}]
			};
		}
	};

	window.FuwaAITools.register(window.FuwaAITools.sources);
})();
