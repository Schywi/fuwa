(function () {
	'use strict';

	window.FuwaAITaskRouter = {
		runTextTask: async function (text, onStatus) {
			onStatus = onStatus || function () {};
			onStatus('Routing task…');

			if (!(window.FuwaAIProviderCompat && window.FuwaAIProviderCompat.analyzeQuestion)) {
				throw new Error('AI task router is not fully initialized.');
			}

			return window.FuwaAIProviderCompat.analyzeQuestion(text, onStatus);
		},
	};
})();
