(function () {
	'use strict';

	var STORAGE_KEY = 'fuwa_ai_provider_key';
	var LEGACY_STORAGE_KEY = 'fuwa_ai_deepseek_key';
	var state = null;

	function readStoredProviderKey() {
		return localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || '';
	}

	function blankState() {
		return {
			messages: [],
			input: '',
			loading: false,
			error: null,
			status: '',
			context_summary: '',
			api_key: readStoredProviderKey(),
		};
	}

	function createState() {
		if (state) return state;
		state = window.PetiteVue && window.PetiteVue.reactive
			? window.PetiteVue.reactive(blankState())
			: blankState();
		return state;
	}

	function patch(updates) {
		var target = createState();
		Object.keys(updates || {}).forEach(function (key) {
			target[key] = updates[key];
		});
		return target;
	}

	function appendMessage(role, content) {
		createState().messages.push({
			role: role,
			content: content,
			id: role.charAt(0) + Date.now(),
		});
	}

	function clearMessages() {
		patch({
			messages: [],
			error: null,
			status: '',
		});
	}

	function setProviderKey(value) {
		var key = (value || '').trim();
		if (!key) return '';
		localStorage.setItem(STORAGE_KEY, key);
		localStorage.setItem(LEGACY_STORAGE_KEY, key);
		patch({ api_key: key });
		return key;
	}

	function getApiKey() {
		return createState().api_key || '';
	}

	window.FuwaAIState = {
		create: createState,
		patch: patch,
		appendMessage: appendMessage,
		clearMessages: clearMessages,
		setProviderKey: setProviderKey,
		getApiKey: getApiKey,
	};
})();
