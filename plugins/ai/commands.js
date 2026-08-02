(function () {
	'use strict';

	window.FuwaAICommands = {
		parse: function (text) {
			var value = (text || '').trim();
			if (!value) return { kind: 'empty' };
			if (value === '/clear') return { kind: 'clear' };
			if (value.indexOf('/key ') === 0) {
				return {
					kind: 'set_provider_key',
					value: value.slice(5).trim(),
				};
			}
			return {
				kind: 'task',
				text: value,
			};
		},
	};
})();
