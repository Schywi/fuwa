(function () {
	'use strict';

	var ROOT_SELECTOR = '[data-ai-root]';
	var LOG_PREFIX = '[shell:ai]';

	var app = null;
	var mounted_roots = new WeakSet();

	function log(msg, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX, msg);
		} else {
			console.info(LOG_PREFIX, msg, detail);
		}
		if (window.FuwaObservability) {
			window.FuwaObservability.log('shell:ai', msg, detail);
		}
	}

	function aiState() {
		return window.FuwaAIState;
	}

	function buildContextSummary() {
		var tools = window.FuwaAITools;
		var store = aiState();
		var memory_count = 0;
		if (store && store.create) {
			memory_count = Number(store.create().memory_recent_count) || 0;
		}
		if (!tools || !tools.list) {
			return memory_count > 0 ? memory_count + ' local memory entries' : '';
		}
		var entries = tools.list();
		var parts = [entries.length + ' task adapters'];
		if (memory_count > 0) {
			parts.push(memory_count + ' local memory entries');
		}
		return parts.join(' · ');
	}

	function setState(updates) {
		var store = aiState();
		return store && store.patch ? store.patch(updates) : null;
	}

	async function refreshMemoryState() {
		var memory = window.FuwaAIMemoryStore;
		if (!(memory && memory.findRecent)) {
			return;
		}

		try {
			var recent = await memory.findRecent({
				limit: 6,
				scope: 'ai_panel',
			});
			setState({
				memory_recent: recent,
				memory_recent_count: recent.length,
				memory_backend: memory.backendLabel ? memory.backendLabel() : 'sqlite-kvvfs',
				memory_error: null,
			});
		} catch (err) {
			log('memory refresh error', err && err.message ? err.message : err);
			setState({
				memory_error: err && err.message ? err.message : String(err),
			});
		}

		setState({ context_summary: buildContextSummary() });
	}

	async function rememberTurn(role, content, kind) {
		var memory = window.FuwaAIMemoryStore;
		if (!(memory && memory.save) || !content) {
			return;
		}

		try {
			var saved = await memory.save({
				kind: kind || 'turn',
				scope: 'ai_panel',
				role: role,
				body: content,
			});
			setState({
				memory_backend: saved.backend || 'localStorage',
				memory_error: null,
			});
		} catch (err) {
			log('memory save error', err && err.message ? err.message : err);
			setState({
				memory_error: err && err.message ? err.message : String(err),
			});
		}

		await refreshMemoryState();
	}

	async function handleSend() {
		var store = aiState();
		var commands = window.FuwaAICommands;
		var router = window.FuwaAITaskRouter;
		if (!(store && commands && router)) return;

		var state = store.create();
		var parsed = commands.parse(state.input);
		if (parsed.kind === 'empty' || state.loading) return;

		if (parsed.kind === 'clear') {
			store.clearMessages();
			setState({ input: '' });
			return;
		}

		if (parsed.kind === 'set_provider_key') {
			if (!parsed.value) {
				setState({ input: '', error: 'Usage: /key sk-...' });
				return;
			}
			store.setProviderKey(parsed.value);
			setState({
				input: '',
				error: null,
				status: 'Compatibility provider key saved locally.',
			});
			return;
		}

		store.appendMessage('user', parsed.text);
		await rememberTurn('user', parsed.text, 'turn');
		setState({
			loading: true,
			error: null,
			input: '',
			status: 'Preparing task…',
			context_summary: buildContextSummary(),
		});

		try {
			var result = await router.runTextTask(parsed.text, function (status_text) {
				setState({ status: status_text });
			});
			store.appendMessage('assistant', result.answer);
			await rememberTurn('assistant', result.answer, 'turn');
		} catch (err) {
			log('task error', err && err.message ? err.message : err);
			var error_text = 'Error: ' + (err && err.message ? err.message : err);
			store.appendMessage('assistant', error_text);
			await rememberTurn('assistant', error_text, 'diagnostic');
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

	function mount(root) {
		if (!(root instanceof Element) || root.hidden) return;
		if (mounted_roots.has(root)) return;

		var store = aiState();
		if (!store || !store.create) return;

		root.removeAttribute('v-pre');
		if (app) {
			app.unmount();
			app = null;
		}

		if (!(window.PetiteVue && window.PetiteVue.createApp)) {
			setTimeout(function () { mount(root); }, 200);
			return;
		}

		var state = store.create();
		app = window.PetiteVue.createApp({
			state: state,
			handleSend: handleSend,
			handleKeydown: handleKeydown,
		});
		app.mount(root);
		mounted_roots.add(root);
		root.setAttribute('data-widget-state', 'mounted');

		if (window.FuwaAIProviderCompat && window.FuwaAIProviderCompat.prime) {
			window.FuwaAIProviderCompat.prime();
		}
		setState({ context_summary: buildContextSummary() });
		void refreshMemoryState();
	}

	function unmount(root) {
		if (app) {
			app.unmount();
			app = null;
		}
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
		getApiKey: function () {
			var store = aiState();
			return store && store.getApiKey ? store.getApiKey() : '';
		},
	};

	document.addEventListener('htmx:beforeSwap', function (event) {
		var target = event.detail && event.detail.target;
		var roots = (target && target.querySelectorAll) ? target.querySelectorAll(ROOT_SELECTOR) : [];
		for (var i = 0; i < roots.length; i++) unmount(roots[i]);
	});

	document.addEventListener('htmx:afterSwap', function (event) {
		var target = event.detail && event.detail.target;
		var roots = (target && target.querySelectorAll) ? target.querySelectorAll(ROOT_SELECTOR) : document.querySelectorAll(ROOT_SELECTOR);
		for (var i = 0; i < roots.length; i++) {
			if (!roots[i].hidden) mount(roots[i]);
		}
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { refresh(); }, { once: true });
	} else {
		refresh();
	}
})();
