// Data provider: payload source files from the editor.
// Always included in the AI context.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	window.FuwaAITools.sources = {
		name: 'sources',
		describe: 'Current payload source files',
		cost: '~500-2000 tokens (varies with file size)',
		always: true,

		collect: function () {
			var editor = window.FuwaShellEditor;
			if (!editor || !(editor.pendingEdits instanceof Map)) return '';

			var entries = [];
			editor.pendingEdits.forEach(function (content, path) {
				entries.push({ path: path, content: content });
			});

			// Also check hidden inputs for files not yet opened
			var form = document.getElementById('ide-editor-form');
			if (form) {
				var pathInput = form.querySelector('input[name="path"]');
				var contentsInput = form.querySelector('input[name="contents"]');
				if (pathInput && contentsInput && pathInput.value) {
					var seen = entries.some(function (e) { return e.path === pathInput.value; });
					if (!seen) {
						entries.push({ path: pathInput.value, content: contentsInput.value });
					}
				}
			}

			if (entries.length === 0) return '';

			entries.sort(function (a, b) { return a.path.localeCompare(b.path); });

			var total_lines = 0;
			var parts = [];
			entries.forEach(function (entry) {
				var lines = entry.content.split('\n');
				total_lines += lines.length;
				parts.push('### ' + entry.path + '\n```lua\n' + entry.content + '\n```');
			});

			return '### Source Files (' + entries.length + ' files, ' + total_lines + ' lines)\n\n' + parts.join('\n\n');
		}
	};

	window.FuwaAITools.register(window.FuwaAITools.sources);
})();
