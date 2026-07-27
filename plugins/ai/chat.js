(function () {
	'use strict';

	// AI assistant chat panel.  Follows the same IIFE + global-registration
	// pattern as shell/hooks/observability.js.  Mounts into [data-ai-root]
	// when the workspace tab is selected.
	//
	// Dependencies: petite-vue (for reactive state), editor.js (for
	// window.FuwaShellEditor.pendingEdits to read payload source).

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
			has_server_config: false,
		};
	}

	function createState() {
		if (state) return state;
		state = window.PetiteVue && window.PetiteVue.reactive
			? window.PetiteVue.reactive(blankState())
			: blankState();
		return state;
	}

	// ── server config ────────────────────────────────────────────────────

	function loadConfig() {
		fetch('/__dev/config')
			.then(function (r) { return r.json(); })
			.then(function (config) {
				var server_key = config.DEEP_SEEK_API;
				if (server_key) {
					setState({ api_key: server_key, has_server_config: true });
				}
			})
			.catch(function () {
				// /__dev/config only exists when dev server is running;
				// without it, the AI tab shows instructions for setting up .env
			});
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

	function readSources() {
		var editor = window.FuwaShellEditor;
		if (!editor || !(editor.pendingEdits instanceof Map)) return {};

		var files = {};
		editor.pendingEdits.forEach(function (content, path) {
			files[path] = content;
		});

		// Also check hidden inputs for files not yet opened in editor
		var form = document.getElementById('ide-editor-form');
		if (form) {
			var pathInput = form.querySelector('input[name="path"]');
			var contentsInput = form.querySelector('input[name="contents"]');
			if (pathInput && contentsInput && pathInput.value) {
				var path = pathInput.value;
				if (!files[path]) {
					files[path] = contentsInput.value;
				}
			}
		}

		return files;
	}

	function estimateTokens(text) {
		// Rough: ~4 chars per token for English text.  Good enough for
		// a context-size gauge.
		var total = 0;
		if (typeof text === 'string') total += Math.ceil(text.length / 4);
		if (state) {
			state.messages.forEach(function (m) {
				total += Math.ceil((m.content || '').length / 4);
			});
		}
		return total;
	}

	function buildSystemPrompt(files) {
		var file_list = Object.keys(files).sort();
		if (file_list.length === 0) {
			return 'You are a helpful coding assistant for the fuwa web framework. '
				+ 'Fuwa compiles .fuwa files (a Ruby-like DSL) to Lua and runs them in '
				+ 'a browser-based Wasmoon (Lua 5.4) VM with SQLite storage. '
				+ 'No payload source files are currently open. Ask the user to open some files.';
		}

		var prompt = 'You are a helpful coding assistant for the fuwa web framework.\n\n';
		prompt += 'Fuwa is a full-stack web framework that runs entirely in the browser: '
			+ '.fuwa source files compile to Lua, execute in a Wasmoon (Lua 5.4) Web Worker, '
			+ 'and persist state in SQLite-WASM. The frontend uses htmx + petite-vue + UnoCSS.\n\n';
		prompt += 'Here are the current payload source files:\n\n';

		file_list.forEach(function (path) {
			var content = files[path];
			prompt += '### ' + path + '\n```lua\n' + content + '\n```\n\n';
		});

		prompt += 'When answering:\n';
		prompt += '- Reference specific files by name.\n';
		prompt += '- If suggesting code changes, wrap them in ```lua blocks with the file path as a comment on the first line, e.g. ```lua\n-- app.fuwa\n';
		prompt += '- Prefer concrete, minimal changes over rewrites.\n';
		prompt += '- If you need more context, ask.';

		return prompt;
	}

	function buildContextLabel() {
		var files = readSources();
		var keys = Object.keys(files);
		if (keys.length === 0) return 'No files open';
		var total_lines = 0;
		keys.forEach(function (k) {
			total_lines += (files[k] || '').split('\n').length;
		});
		return keys.length + ' files \u00b7 ' + total_lines + ' lines';
	}

	function setState(updates) {
		var s = createState();
		Object.keys(updates).forEach(function (k) {
			s[k] = updates[k];
		});
	}

	// ── DeepSeek API ────────────────────────────────────────────────────

	function buildMessages(userMessage) {
		var files = readSources();
		var system = buildSystemPrompt(files);

		var msgs = [{ role: 'system', content: system }];

		// Last N conversation turns (omit system prompt from history)
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
				setState({ streaming_content: buffer.content, token_count: estimateTokens(buffer.content) });
			}
		} catch (e) {
			// skip malformed lines
		}
	}

	async function sendMessage(userMessage) {
		var s = createState();
		var key = s.api_key;
		if (!key) {
			setState({ error: 'API key not configured. Set DEEP_SEEK_API in .env and restart the dev server.', loading: false });
			return;
		}

		var s = createState();
		s.messages.push({ role: 'user', content: userMessage, id: 'u' + Date.now() });
		setState({ loading: true, error: null, streaming_content: '', context_summary: buildContextLabel() });

		var msgs = buildMessages(userMessage);
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

			// Process any remaining data
			if (leftover.trim()) {
				handleStreamLine(leftover, buffer);
			}

			// Finalize
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

	// ── apply suggestion ─────────────────────────────────────────────────

	function applyCodeBlock(code_block) {
		// Parse the first line comment for file path: -- app.fuwa
		var lines = code_block.split('\n');
		var first_line = lines[0] || '';
		var file_path = '';
		var match = first_line.match(/^--\s*(\S+\.\w+)/);
		if (match) {
			file_path = match[1];
			lines.shift(); // Remove the comment line
		}

		var content = lines.join('\n').trim();
		if (!content) {
			log('apply: empty content');
			return;
		}

		// If no file path hint, try to guess from the current open file
		if (!file_path) {
			var form = document.getElementById('ide-editor-form');
			if (form) {
				var pathInput = form.querySelector('input[name="path"]');
				if (pathInput && pathInput.value) {
					file_path = pathInput.value;
				}
			}
		}

		if (!file_path) {
			log('apply: no file path determined');
			alert('Could not determine which file to apply to. Add a -- filename.fuwa comment on the first line of the code block.');
			return;
		}

		// Find and switch to the file
		var editor = window.FuwaShellEditor;
		if (!editor || typeof editor.switchFile !== 'function') {
			log('apply: editor not available');
			return;
		}

		var root = document.querySelector('[data-editor-root]');
		if (root) {
			editor.switchFile(root, file_path, content);
			log('apply: switched to ' + file_path);
		}
	}

	function extractCodeBlock(text) {
		// Match ```lua or ``` blocks
		var match = text.match(/```(?:lua)?\s*\n([\s\S]*?)```/);
		return match ? match[1] : null;
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

		// Each mount gets a fresh reactive state singleton
		state = createState();
		app = window.PetiteVue.createApp({
			state: state,
			handleSend: handleSend,
			handleKeydown: handleKeydown,
			applyCodeBlock: applyCodeBlock,
			extractCodeBlock: extractCodeBlock,
		});
		app.mount(root);
		mounted_roots.add(root);
		root.setAttribute('data-widget-state', 'mounted');

		loadConfig();
		setState({ context_summary: buildContextLabel() });
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

	// Wire into htmx lifecycle
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
