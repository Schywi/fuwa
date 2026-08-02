(function () {
	'use strict';

	// Read-only AI analyst.  Thin UI shell — all intelligence lives in
	// plugins/ai/tools/orchestrator.js and the tool adapters.
	// The preferred API key source is a dev config endpoint when available,
	// but this integration branch also supports a localStorage fallback via
	// the /key command because the OpenResty shell does not expose /__dev/config.
	// Model: deepseek-v4-flash for both planner and analyst passes.

	var ROOT_SELECTOR = '[data-ai-root]';
	var LOG_PREFIX = '[shell:ai]';

	var app = null;
	var state = null;
	var mounted_roots = new WeakSet();

	// ── petite-vue state ────────────────────────────────────────────────

	function blankState() {
		return {
			messages: [],
			input: '',
			loading: false,
			error: null,
			status: '',
			context_summary: '',
			api_key: localStorage.getItem('fuwa_ai_deepseek_key') || '',
		};
	}

	function createState() {
		if (state) return state;
		state = window.PetiteVue && window.PetiteVue.reactive
			? window.PetiteVue.reactive(blankState())
			: blankState();
		return state;
	}

	// ── helpers ──────────────────────────────────────────────────────────

	function log(msg, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX, msg);
		} else {
			console.info(LOG_PREFIX, msg, detail);
		}
		window.FuwaObservability && window.FuwaObservability.log('shell:ai', msg, detail);
	}

	function setState(updates) {
		var s = createState();
		Object.keys(updates).forEach(function (k) {
			s[k] = updates[k];
		});
	}

	function getApiKey() {
		return createState().api_key;
	}

	function buildContextSummary() {
		var tools = window.FuwaAITools;
		if (!tools || !tools.list) return '';
		var entries = tools.list();
		return entries.length + ' data sources';
	}

	// ── server config ────────────────────────────────────────────────────

	function loadConfig() {
		fetch('/__dev/config')
			.then(function (r) { return r.json(); })
			.then(function (config) {
				var server_key = config.DEEP_SEEK_API;
				if (server_key) setState({ api_key: server_key });
			})
			.catch(function () {});

		if (!createState().api_key) {
			var local_key = localStorage.getItem('fuwa_ai_deepseek_key') || '';
			if (local_key) setState({ api_key: local_key });
		}

		if (window.FuwaAITools && window.FuwaAITools.prefetch) {
			window.FuwaAITools.prefetch();
		}
	}

	// ── main flow ────────────────────────────────────────────────────────

	async function handleSend() {
		var s = createState();
		var text = (s.input || '').trim();
		if (!text || s.loading) return;

		if (text === '/clear') {
			s.messages = [];
			setState({ input: '', error: null });
			return;
		}
		if (text.indexOf('/key ') === 0) {
			var provided = text.slice(5).trim();
			if (!provided) {
				setState({ input: '', error: 'Usage: /key sk-...' });
				return;
			}
			localStorage.setItem('fuwa_ai_deepseek_key', provided);
			setState({ api_key: provided, input: '', error: null, status: 'API key saved locally.' });
			return;
		}

		s.messages.push({ role: 'user', content: text, id: 'u' + Date.now() });
		setState({ loading: true, error: null, input: '', status: 'Classifying…', context_summary: buildContextSummary() });

		try {
			var agent = window.FuwaAIAgent;
			if (!agent) throw new Error('AI agent not loaded. Refresh the page.');

			var result = await agent.investigate(text, function (status_text) {
				setState({ status: status_text });
			});

			s.messages.push({ role: 'assistant', content: result.answer, id: 'a' + Date.now() });
		} catch (err) {
			log('agent error', err.message);
			s.messages.push({ role: 'assistant', content: 'Error: ' + err.message, id: 'a' + Date.now() });
		} finally {
			setState({ loading: false, status: '', input: '' });
		}
	}

	function handleKeydown(event) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	// ── lifecycle ────────────────────────────────────────────────────────

	function mount(root) {
		if (!(root instanceof Element) || root.hidden) return;
		if (!state) state = createState();
		if (mounted_roots.has(root)) return;

		root.removeAttribute('v-pre');
		if (app) { app.unmount(); app = null; }

		if (!(window.PetiteVue && window.PetiteVue.createApp)) {
			setTimeout(function () { mount(root); }, 200);
			return;
		}

		state = createState();
		app = window.PetiteVue.createApp({
			state: state,
			handleSend: handleSend,
			handleKeydown: handleKeydown,
		});
		app.mount(root);
		mounted_roots.add(root);
		root.setAttribute('data-widget-state', 'mounted');

		loadConfig();
		setState({ context_summary: buildContextSummary() });
	}

	function unmount(root) {
		if (app) { app.unmount(); app = null; }
		if (root instanceof Element) root.removeAttribute('data-widget-state');
		mounted_roots.delete(root);
	}

	function refresh(scope) {
		var roots = scope ? scope.querySelectorAll(ROOT_SELECTOR) : document.querySelectorAll(ROOT_SELECTOR);
		for (var i = 0; i < roots.length; i++) {
			if (!roots[i].hidden) mount(roots[i]);
		}
	}

	window.FuwaShellAI = {
		mount: mount,
		unmount: unmount,
		refresh: refresh,
		selector: ROOT_SELECTOR,
		getApiKey: getApiKey,
	};

	document.addEventListener('htmx:beforeSwap', function (e) {
		var s = e.detail && e.detail.target;
		var roots = (s && s.querySelectorAll) ? s.querySelectorAll(ROOT_SELECTOR) : [];
		for (var i = 0; i < roots.length; i++) unmount(roots[i]);
	});
	document.addEventListener('htmx:afterSwap', function (e) {
		var s = e.detail && e.detail.target;
		var roots = (s && s.querySelectorAll) ? s.querySelectorAll(ROOT_SELECTOR) : document.querySelectorAll(ROOT_SELECTOR);
		for (var i = 0; i < roots.length; i++) { if (!roots[i].hidden) mount(roots[i]); }
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { refresh(); }, { once: true });
	} else {
		refresh();
	}
})();
