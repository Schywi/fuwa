// Data provider: terminal output from the active runtime session.
// On-demand only. Default mode extracts error blocks only.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	window.FuwaAITools.terminal = {
		name: 'terminal',
		describe: 'Terminal output (error blocks by default, full output on request)',
		cost: '~200-400 tokens',
		always: false,
		triggers: ['error', 'crash', 'fail', 'compile', 'terminal', 'output', '/term'],

		collect: function () {
			return this.collectFormatted(30, 'error_first');
		},

		collectFormatted: function (lines, mode) {
			lines = lines || 30;
			mode = mode || 'error_first';
			var text = readTerminal(lines, mode);
			if (!text) return { type: 'terminal_output', source: 'terminal', items: [] };

			if (mode === 'error_first') {
				var error = extractLastError(text);
				if (error) {
					return {
						type: 'terminal_error',
						source: 'terminal',
						items: [{
							message: error.message,
							file: error.file || null,
							line: error.line || null,
						}]
					};
				}
			}

			return {
				type: 'terminal_output',
				source: 'terminal',
				items: [{ text: text }]
			};
		}
	};

	function readTerminal(max_lines, mode) {
		var terminal = window.FuwaShellTerminal;
		if (!terminal || typeof terminal.readLines !== 'function') return '';

		var stage = document.querySelector('[data-preview-stage]');
		var session_id = stage ? stage.getAttribute('data-payload-id') || 'current' : 'current';
		var text = terminal.readLines(session_id, max_lines);

		if (mode === 'error_first') {
			var error = extractLastError(text);
			if (error) return error.raw || text;
		}

		return text.trim() || '';
	}

	function extractLastError(text) {
		if (!text) return null;

		// Look for common Lua error patterns
		var patterns = [
			// attempt to index/concatenate/call nil/table/etc
			/attempt to (\w+).*\n(?:stack traceback:[\s\S]*?)?([^\n]*\.(?:fuwa|lua):(\d+))/i,
			// module not found
			/module ['"](\S+)['"] not found/i,
			// syntax error
			/(syntax error[^\n]*)/i,
			// build failed
			/(?:\[build\]|build failed|compilation error)[^\n]*/i,
			// generic runtime error with file:line
			/((?:runtime )?error[:\s]+[^\n]*)/i,
		];

		for (var i = 0; i < patterns.length; i++) {
			var match = text.match(patterns[i]);
			if (match) {
				// Try to extract file:line
				var file_line = text.match(/([\w\/-]+\.(?:fuwa|lua)):(\d+)/);
				return {
					message: match[1] || match[0],
					raw: match[0] + (match[2] ? '\n' + match[2] : ''),
					file: file_line ? file_line[1] : null,
					line: file_line ? parseInt(file_line[2], 10) : null,
				};
			}
		}

		return null;
	}

	window.FuwaAITools.register(window.FuwaAITools.terminal);
})();
