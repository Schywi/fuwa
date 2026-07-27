// Data provider: terminal output from the active runtime session.
// On-demand only — included when user mentions errors, output, or uses /term.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	window.FuwaAITools.terminal = {
		name: 'terminal',
		describe: 'Last 20 lines of terminal output from the active session',
		cost: '~300 tokens',
		always: false,
		triggers: ['error', 'output', 'terminal', 'compile', 'crash', 'failed', '/term'],

		collect: function () {
			var terminal = window.FuwaShellTerminal;
			if (!terminal || typeof terminal.readLines !== 'function') return '';

			// Find the active payload id
			var stage = document.querySelector('[data-preview-stage]');
			var session_id = stage ? stage.getAttribute('data-payload-id') || 'current' : 'current';

			var text = terminal.readLines(session_id, 20);
			if (!text.trim()) return '';

			return '### Terminal Output (last 20 lines)\n```\n' + text + '\n```';
		}
	};

	window.FuwaAITools.register(window.FuwaAITools.terminal);
})();
