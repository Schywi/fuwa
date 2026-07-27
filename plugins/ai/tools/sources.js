// Data provider: payload source files from the editor.
// On-demand only — never auto-included. The classifier decides when to pull code.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	function readSources() {
		var editor = window.FuwaShellEditor;
		if (!editor || !(editor.pendingEdits instanceof Map)) return {};
		var files = {};
		editor.pendingEdits.forEach(function (content, path) { files[path] = content; });
		return files;
	}

	function readActiveFilePath() {
		var form = document.getElementById('ide-editor-form');
		if (form) {
			var pathInput = form.querySelector('input[name="path"]');
			if (pathInput && pathInput.value) return pathInput.value;
		}
		return null;
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
