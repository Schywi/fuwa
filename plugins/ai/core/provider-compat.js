(function () {
	'use strict';

	var CONFIG_ENDPOINT = '/__dev/config';
	var MODEL_URL = 'https://api.deepseek.com/chat/completions';
	var MODEL_NAME = 'deepseek-v4-flash';

	function getState() {
		return window.FuwaAIState;
	}

	function getApiKey() {
		return getState() && getState().getApiKey ? getState().getApiKey() : '';
	}

	function prefetchTools() {
		if (window.FuwaAITools && window.FuwaAITools.prefetch) {
			window.FuwaAITools.prefetch();
		}
	}

	function prime() {
		var state = getState();
		if (!state) return;

		fetch(CONFIG_ENDPOINT)
			.then(function (response) { return response.json(); })
			.then(function (config) {
				if (config && config.DEEP_SEEK_API) {
					state.setProviderKey(config.DEEP_SEEK_API);
				}
			})
			.catch(function () {});

		prefetchTools();
	}

	async function callJsonModel(messages, options) {
		var key = getApiKey();
		if (!key) {
			throw new Error('Compatibility provider key not configured. Use /key sk-... to enable remote fallback.');
		}

		options = options || {};
		var response = await fetch(MODEL_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Bearer ' + key,
			},
			body: JSON.stringify({
				model: options.model || MODEL_NAME,
				messages: messages,
				temperature: options.temperature === undefined ? 0.1 : options.temperature,
				max_tokens: options.max_tokens || 1024,
				response_format: { type: 'json_object' },
			}),
		});

		if (!response.ok) {
			var err = await response.text().catch(function () { return 'Unknown'; });
			throw new Error('Provider compatibility error ' + response.status + ': ' + err);
		}

		var data = await response.json();
		var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
		if (!content) throw new Error('Empty compatibility response');

		try {
			return JSON.parse(content);
		} catch (err) {
			throw new Error('Compatibility provider returned invalid JSON: ' + content.slice(0, 200));
		}
	}

	async function analyzeQuestion(question, onStatus) {
		if (!(window.FuwaAIAgent && window.FuwaAIAgent.investigate)) {
			throw new Error('AI agent not loaded. Refresh the page.');
		}
		return window.FuwaAIAgent.investigate(question, onStatus);
	}

	window.FuwaAIProviderCompat = {
		prime: prime,
		getApiKey: getApiKey,
		callJsonModel: callJsonModel,
		analyzeQuestion: analyzeQuestion,
	};
})();
