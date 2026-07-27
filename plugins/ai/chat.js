(function () {
	'use strict';

	// Read-only AI assistant.  Reads source files and runtime data through
	// categorized tools (plugins/ai/tools/*.js).  Cannot modify code.
	// The API key comes exclusively from the dev server via /__dev/config.

	var ROOT_SELECTOR = '[data-ai-root]';
	var DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
	var MODEL = 'deepseek-chat';
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
			streaming_content: '',
			context_summary: '',
			api_key: '',
			token_count: 0,
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

	function buildContextSummary() {
		var tools = window.FuwaAITools;
		if (!tools || !tools.list) return '';
		var entries = tools.list();
		if (entries.length === 0) return 'No data sources available';
		return entries.length + ' data sources ready';
	}

	// ── server config ────────────────────────────────────────────────────

	function loadConfig() {
		fetch('/__dev/config')
			.then(function (r) { return r.json(); })
			.then(function (config) {
				var server_key = config.DEEP_SEEK_API;
				if (server_key) {
					setState({ api_key: server_key });
				}
			})
			.catch(function () {
				// /__dev/config only exists when dev server is running
			});

		// Prefetch traces in the background
		if (window.FuwaAITools && window.FuwaAITools.prefetch) {
			window.FuwaAITools.prefetch();
		}
	}

	// ── system prompt builder ────────────────────────────────────────────

	function buildSystemPrompt(userMessage) {
		var tools = window.FuwaAITools;
		var ctx = tools && tools.buildContext ? tools.buildContext(userMessage) : { context: '', tools_ref: '', requested_tools: [] };

		var prompt = [
			'You are a READ-ONLY assistant for the fuwa web framework.',
			'',
			'Fuwa is a full-stack web framework that runs entirely in the browser: .fuwa source files compile to Lua, execute in a Wasmoon (Lua 5.4) Web Worker, and persist state in SQLite-WASM. The frontend uses htmx + petite-vue + UnoCSS.',
			'',
			'RULES:',
			'- You CANNOT modify code. Explain, analyze, and suggest only.',
			'- Reference specific files by name.',
			'- If you need more context, ask the user to check a specific tool.',
			'- Keep answers concise and actionable.',
			'',
			ctx.tools_ref,
			'',
			ctx.context,
		].join('\n');

		return { prompt: prompt, requested_tools: ctx.requested_tools };
	}

	// ── DeepSeek API ────────────────────────────────────────────────────

	function buildMessages(userMessage, systemPrompt) {
		var msgs = [{ role: 'system', content: systemPrompt }];

		// Last N conversation turns
		var recent = state.messages.slice(-10);
		recent.forEach(function (m) {
			msgs.push({ role: m.role, content: m.content });
		});

		msgs.push({ role: 'user', content: userMessage });
		return msgs;
	}

	function handleStreamLine(line, buffer) {
		if (!line || line.trim() === '') return;
		if (line === 'data: [DONE]') return;
		if (!line.startsWith('data: ')) return;

		var json_str = line.slice(6);
		try {
			var parsed = JSON.parse(json_str);
			var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
			if (delta && delta.content) {
				buffer.content += delta.content;
				setState({ streaming_content: buffer.content });
			}
		} catch (e) {
			// skip malformed lines
		}
	}

	async function collectOnDemandContext(requested_tools) {
		if (!requested_tools || requested_tools.length === 0) return '';
		var tools = window.FuwaAITools;
		if (!tools || !tools.collectOnDemand) return '';
		return tools.collectOnDemand(requested_tools);
	}

	async function sendMessage(userMessage) {
		var s = createState();
		var key = s.api_key;
		if (!key) {
			setState({ error: 'API key not configured. Set DEEP_SEEK_API in .env and restart the dev server.', loading: false });
			return;
		}

		s.messages.push({ role: 'user', content: userMessage, id: 'u' + Date.now() });
		setState({ loading: true, error: null, streaming_content: '', context_summary: buildContextSummary() });

		var built = buildSystemPrompt(userMessage);
		var msgs = buildMessages(userMessage, built.prompt);

		// Collect on-demand data (DB, modules, terminal) if triggered
		if (built.requested_tools.length > 0) {
			try {
				var extra = await collectOnDemandContext(built.requested_tools);
				if (extra) {
					// Append to system prompt
					msgs[0].content = msgs[0].content + '\n\n' + extra;
				}
			} catch (e) {
				log('on-demand collect error', e.message);
			}
		}

		var buffer = { content: '' };

		try {
			var response = await fetch(DEEPSEEK_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer ' + key,
				},
				body: JSON.stringify({
					model: MODEL,
					messages: msgs,
					stream: true,
					temperature: 0.3,
					max_tokens: 4096,
				}),
			});

			if (!response.ok) {
				var err_text = await response.text().catch(function () { return 'Unknown error'; });
				throw new Error('API error ' + response.status + ': ' + err_text);
			}

			var reader = response.body.getReader();
			var decoder = new TextDecoder();
			var leftover = '';

			while (true) {
				var chunk = await reader.read();
				if (chunk.done) break;

				var text = decoder.decode(chunk.value, { stream: true });
				var lines = (leftover + text).split('\n');
				leftover = lines.pop() || '';

				lines.forEach(function (line) {
					handleStreamLine(line, buffer);
				});
			}

			if (leftover.trim()) {
				handleStreamLine(leftover, buffer);
			}

			if (buffer.content) {
				s.messages.push({ role: 'assistant', content: buffer.content, id: 'a' + Date.now() });
			} else {
				s.messages.push({ role: 'assistant', content: '(empty response)', id: 'a' + Date.now() });
			}
		} catch (err) {
			log('send error', err.message);
			setState({ error: err.message });
		} finally {
			setState({ loading: false, streaming_content: '', input: '' });
		}
	}

	function handleSend() {
		var s = createState();
		var text = (s.input || '').trim();
		if (!text || s.loading) return;

		if (text === '/clear') {
			s.messages = [];
			setState({ input: '', error: null });
			return;
		}

		sendMessage(text);
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
		if (root instanceof Element) {
			root.removeAttribute('data-widget-state');
		}
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
