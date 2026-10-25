(function () {
	'use strict';

	// Workspace chrome: petite-vue owns popover state, this hook only supplies
	// the tiny imperative seams that templates cannot express well: outside
	// clicks, search filtering, and keyboard focus within the rendered list.

	const LOG_PREFIX = '[shell:workspace]';
	let booted = false;
	let retry_timer = null;
	let workspace_state = null;
	let active_state = null;
	let mounted_app = null;
	const mounted_roots = new WeakSet();

	// The assistant is served by OpenResty under /assistant/ (nginx.conf), so
	// the shell renders the Python app's own HTML fragments on its own origin
	// instead of re-implementing them. Every assistant route is reachable:
	// /assistant/ , /ui/message , /chat , /investigate , /speak ,
	// /voice/transcribe , /actions* , /plan , /audio/{id} , /metrics .
	const ASSISTANT_BASE = '/assistant';
	const ASSISTANT_SESSION_KEY = 'fuwa-assistant-session';

	function createAssistantSessionId() {
		return 'fuwa-' + Math.random().toString(36).slice(2, 10);
	}

	function assistantSessionId() {
		try {
			const existing = window.localStorage.getItem(ASSISTANT_SESSION_KEY);
			if (existing) return existing;
			const created = createAssistantSessionId();
			window.localStorage.setItem(ASSISTANT_SESSION_KEY, created);
			return created;
		} catch (err) {
			return 'fuwa-anon';
		}
	}

	// Rotate the id the assistant threads conversations under, and remember it
	// so a reload keeps the same (fresh) conversation.
	function rotateAssistantSessionId() {
		const created = createAssistantSessionId();
		try {
			window.localStorage.setItem(ASSISTANT_SESSION_KEY, created);
		} catch (err) {
			log('assistant:session-persist-failed', err && err.message);
		}
		return created;
	}

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	// petite-vue wraps the initial data in its own reactive proxy
	// (createApp → reactive(scope)). The object kept in this module is the raw
	// target: writing to it updates data but notifies no effect, so the UI never
	// re-renders. Template-invoked handlers get the proxy as `this`, so capture
	// it there and drive module-level actions (deep links, frame clicks) through
	// it — otherwise a clicked evidence link changes state silently.
	let assistant_scope = null;

	function assistantState(candidate) {
		if (candidate && candidate !== workspace_state) {
			assistant_scope = candidate;
		}
		return assistant_scope || workspace_state;
	}

	// ── Assistant fragment seams ──────────────────────────────────
	// /ui/message returns the Python app's own HTML. These helpers keep that
	// markup working on fuwa's origin: rewrite root-relative asset URLs through
	// the proxy, play the 🔊 audio, copy reproducible commands, and route
	// evidence links into the panel instead of a new tab.

	function assistantToast(message, is_error) {
		const host = document.querySelector('[data-assistant-toast]');
		if (!host) {
			return;
		}
		const toast = document.createElement('div');
		toast.className = 'toast' + (is_error ? ' err' : '');
		toast.textContent = message;
		host.appendChild(toast);
		window.setTimeout(function () {
			toast.remove();
		}, 6000);
	}

	// data-audio="/audio/{id}" targets the assistant's root, not the shell's.
	// nginx's sub_filter may have prefixed it already; never prefix twice.
	function assistantProxyUrl(value) {
		if (!value || value.charAt(0) !== '/' || value.charAt(1) === '/') {
			return value;
		}
		if (value === ASSISTANT_BASE || value.indexOf(ASSISTANT_BASE + '/') === 0) {
			return value;
		}
		return ASSISTANT_BASE + value;
	}

	function rewriteAssistantUrls(root) {
		for (const node of root.querySelectorAll('[href],[src],[data-audio]')) {
			for (const attribute of ['href', 'src', 'data-audio']) {
				const value = node.getAttribute(attribute);
				const proxied = assistantProxyUrl(value);
				if (proxied !== value) {
					node.setAttribute(attribute, proxied);
				}
			}
		}

		// The assistant emits target="_blank" on evidence links. Drop it so a
		// missed click path still cannot spawn a tab, and mark the anchors the
		// shell routes into the panel.
		for (const anchor of root.querySelectorAll('a[target], a[rel]')) {
			anchor.removeAttribute('target');
			anchor.removeAttribute('rel');
		}
	}

	// The transcript lives in the DOM, and htmx replaces the whole view on
	// navigation. Keep a structured copy so a swap does not lose the
	// conversation: {kind:'user', text} | {kind:'bot', html} | {kind:'error', text}.
	let assistant_transcript = [];

	function rememberAssistantQuestion(text) {
		assistant_transcript.push({ kind: 'user', text: text });
	}

	function rememberAssistantAnswer(fragment) {
		assistant_transcript.push({ kind: 'bot', html: fragment });
	}

	function rememberAssistantError(text) {
		assistant_transcript.push({ kind: 'error', text: text });
	}

	function clearAssistantTranscript() {
		assistant_transcript = [];
	}

	function renderAssistantTranscript(thread) {
		for (const entry of assistant_transcript) {
			if (entry.kind === 'user') {
				const node = document.createElement('div');
				node.className = 'msg user';
				node.textContent = entry.text;
				thread.appendChild(node);
				continue;
			}
			if (entry.kind === 'bot') {
				const holder = document.createElement('div');
				holder.innerHTML = entry.html;
				rewriteAssistantUrls(holder);
				while (holder.firstChild) {
					thread.appendChild(holder.firstChild);
				}
				continue;
			}
			const node = document.createElement('div');
			node.className = 'msg bot err';
			node.textContent = entry.text;
			thread.appendChild(node);
		}
	}

	function restoreAssistantTranscript() {
		const thread = document.querySelector('[data-assistant-thread]');
		if (!thread || assistant_transcript.length === 0) {
			return;
		}
		if (thread.children && thread.children.length > 0) {
			return; // live content wins; never clobber a mounted transcript
		}
		renderAssistantTranscript(thread);
		thread.scrollTop = thread.scrollHeight;
		log('assistant:thread-restored', { entries: assistant_transcript.length });
	}

	function playAssistantAudio(button, blob) {
		const audio = document.createElement('audio');
		audio.controls = true;
		audio.autoplay = true;
		audio.src = URL.createObjectURL(blob);
		button.replaceWith(audio);
	}

	function speakOnDemand(button, text) {
		const started = performance.now();
		return window
			.fetch(ASSISTANT_BASE + '/speak', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text })
			})
			.then(function (response) {
				if (!response.ok) {
					throw new Error('HTTP ' + response.status);
				}
				return response.blob();
			})
			.then(function (blob) {
				playAssistantAudio(button, blob);
				assistantToast('TTS ready in ' + ((performance.now() - started) / 1000).toFixed(2) + 's');
			});
	}

	function toggleAssistantSpeech(button) {
		const label = button.textContent;
		const text = button.getAttribute('data-text') || '';
		const audio_url = button.getAttribute('data-audio');

		button.disabled = true;
		button.textContent = '…';

		const pending_audio = audio_url
			? window.fetch(audio_url).then(function (response) {
					if (response.status === 200) {
						return response.blob();
					}
					if (response.status === 202) {
						const pending = new Error('tts pending');
						pending.pending = true;
						throw pending;
					}
					throw new Error('HTTP ' + response.status);
				})
			: Promise.resolve(null);

		pending_audio
			.then(function (blob) {
				if (blob) {
					playAssistantAudio(button, blob);
					assistantToast('Played background TTS');
					return null;
				}
				return speakOnDemand(button, text);
			})
			.catch(function (error) {
				if (error && error.pending) {
					assistantToast('TTS still generating…');
					return speakOnDemand(button, text);
				}
				assistantToast('TTS failed: ' + ((error && error.message) || error), true);
				return null;
			})
			.finally(function () {
				button.disabled = false;
				button.textContent = label;
			});
	}

	// Voice: MediaRecorder → POST /assistant/voice/transcribe (multipart).
	// The assistant answers 501 until STT_URL is configured; that is surfaced
	// as a diagnostic, never swallowed.
	let assistant_recorder = null;
	// The assistant has no cancel route; aborting the fetch only stops waiting on
	// this side (the server finishes its work regardless).
	let assistant_abort = null;

	function uploadAssistantVoice(blob, apply_transcript) {
		const form = new window.FormData();
		form.append('file', blob, 'voice.webm');

		window
			.fetch(ASSISTANT_BASE + '/voice/transcribe', { method: 'POST', body: form })
			.then(function (response) {
				if (response.status === 501) {
					throw new Error('STT not configured on the assistant (501)');
				}
				if (!response.ok) {
					throw new Error('HTTP ' + response.status);
				}
				return response.json();
			})
			.then(function (payload) {
				const text = String((payload && payload.text) || '').trim();
				if (text === '') {
					throw new Error('empty transcript');
				}
				apply_transcript(text);
				assistantToast('Transcript ready');
			})
			.catch(function (error) {
				log('assistant:transcribe-failed', error.message);
				assistantToast('Transcription failed: ' + error.message, true);
			});
	}

	function startAssistantRecorder(stream, state) {
		const chunks = [];
		const recorder = new window.MediaRecorder(stream);
		assistant_recorder = recorder;
		state.assistantRecording = true;
		log('assistant:recording-start', { mime: recorder.mimeType || 'audio/webm' });

		recorder.addEventListener('dataavailable', function (event) {
			if (event.data && event.data.size > 0) {
				chunks.push(event.data);
			}
		});

		recorder.addEventListener('stop', function () {
			for (const track of stream.getTracks()) {
				track.stop();
			}
			assistant_recorder = null;
			state.assistantRecording = false;
			log('assistant:recording-stop', { chunks: chunks.length });
			if (chunks.length === 0) {
				assistantToast('Nothing recorded', true);
				return;
			}
			uploadAssistantVoice(new window.Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), function (text) {
				state.assistantInput = text;
			});
		});

		recorder.start();
	}

	// Metrics: GET /assistant/metrics is Prometheus text. Reduce it to the few
	// numbers worth a drawer panel instead of dumping 400 lines on the user.
	function parseMetricLabels(raw) {
		const labels = {};
		if (!raw) {
			return labels;
		}
		for (const match of raw.matchAll(/([A-Za-z_][\w]*)\s*=\s*"([^"]*)"/g)) {
			labels[match[1]] = match[2];
		}
		return labels;
	}

	function parseAssistantMetrics(text) {
		const stages = new Map();
		const tools = new Map();
		const summary = { stages: [], tools: [], rejected: 0 };

		function stage(name) {
			if (!stages.has(name)) {
				stages.set(name, {
					stage: name,
					requests: 0,
					seconds: 0,
					calls: 0,
					input_tokens: 0,
					output_tokens: 0,
					ttft_seconds: 0,
					ttft_calls: 0
				});
			}
			return stages.get(name);
		}

		function tool(name) {
			if (!tools.has(name)) {
				tools.set(name, { tool: name, calls: 0, seconds: 0 });
			}
			return tools.get(name);
		}

		for (const line of String(text || '').split('\n')) {
			const trimmed = line.trim();
			if (trimmed === '' || trimmed.charAt(0) === '#') {
				continue;
			}
			const match = /^([A-Za-z_:][\w:]*)(?:\{(.*)\})?\s+(-?[\d.eE+]+)$/.exec(trimmed);
			if (!match) {
				continue;
			}
			const value = Number(match[3]);
			if (!Number.isFinite(value)) {
				continue;
			}
			const labels = parseMetricLabels(match[2]);
			const stage_label = labels.stage || 'unknown';

			// Only LLM families create stage rows; unlabelled counters such as
			// assistant_concurrency_rejected_total must not invent an 'unknown' one.
			switch (match[1]) {
				case 'assistant_llm_requests_total':
					stage(stage_label).requests += value;
					break;
				case 'assistant_llm_request_seconds_sum':
					stage(stage_label).seconds += value;
					break;
				case 'assistant_llm_request_seconds_count':
					stage(stage_label).calls += value;
					break;
				case 'assistant_llm_ttft_seconds_sum':
					stage(stage_label).ttft_seconds += value;
					break;
				case 'assistant_llm_ttft_seconds_count':
					stage(stage_label).ttft_calls += value;
					break;
				case 'assistant_llm_input_tokens_total':
					stage(stage_label).input_tokens += value;
					break;
				case 'assistant_llm_output_tokens_total':
					stage(stage_label).output_tokens += value;
					break;
				case 'assistant_tool_seconds_sum':
					tool(labels.tool || 'unknown').seconds += value;
					break;
				case 'assistant_tool_seconds_count':
					tool(labels.tool || 'unknown').calls += value;
					break;
				case 'assistant_concurrency_rejected_total':
					summary.rejected += value;
					break;
				default:
					break;
			}
		}

		function averageMs(seconds, calls) {
			return calls > 0 ? Math.round((seconds / calls) * 1000) : null;
		}

		summary.stages = Array.from(stages.values())
			.map(function (entry) {
				return {
					stage: entry.stage,
					requests: entry.requests,
					avg_ms: averageMs(entry.seconds, entry.calls),
					ttft_ms: averageMs(entry.ttft_seconds, entry.ttft_calls),
					input_tokens: entry.input_tokens,
					output_tokens: entry.output_tokens
				};
			})
			.sort(function (left, right) {
				return left.stage < right.stage ? -1 : left.stage > right.stage ? 1 : 0;
			});

		summary.tools = Array.from(tools.values())
			.map(function (entry) {
				return { tool: entry.tool, calls: entry.calls, avg_ms: averageMs(entry.seconds, entry.calls) };
			})
			.sort(function (left, right) {
				return left.tool < right.tool ? -1 : left.tool > right.tool ? 1 : 0;
			});

		return summary;
	}

	function copyAssistantText(button) {
		const text = button.getAttribute('data-copy') || '';
		if (!(navigator.clipboard && navigator.clipboard.writeText)) {
			assistantToast('Copy failed', true);
			return;
		}
		navigator.clipboard.writeText(text).then(
			function () {
				assistantToast('Copied');
			},
			function () {
				assistantToast('Copy failed', true);
			}
		);
	}

	function describeScope(scope) {
		if (!(scope instanceof Element)) {
			return null;
		}

		return {
			tag: scope.tagName.toLowerCase(),
			id: scope.id || null,
			activeView: scope.getAttribute('data-active-view') || null,
			hasScope: scope.hasAttribute('v-scope')
		};
	}

	function workspaceRoot(node) {
		return node instanceof Element ? node.closest('[data-workspace]') : null;
	}

	function resolveScope(scope, reason) {
		if (scope instanceof Element && document.contains(scope)) {
			return scope;
		}

		if (scope instanceof Element) {
			log(reason + ':fallback-document-body', describeScope(scope));
		}

		return document.body || document;
	}

	function rememberMounted(target) {
		if (!(target instanceof Element)) {
			return;
		}

		mounted_roots.add(target);
		for (const workspace of target.querySelectorAll('[data-workspace]')) {
			mounted_roots.add(workspace);
		}
	}

	function currentRows(popover) {
		return Array.from(popover.querySelectorAll('[data-file-path]')).filter(function (row) {
			return !row.hidden;
		});
	}

	function applyFilter(popover, query) {
		const needle = query.trim().toLowerCase();
		for (const row of popover.querySelectorAll('[data-file-path]')) {
			row.hidden = needle !== '' && !row.dataset.filePath.toLowerCase().includes(needle);
			row.removeAttribute('data-focused');
		}
		// Hide folder headers when all their files are filtered out
		const children = Array.from(popover.children);
		let current_header = null;
		let visible_in_group = false;
		for (const child of children) {
			if (child.hasAttribute('data-folder-header')) {
				if (current_header) current_header.hidden = needle !== '' && !visible_in_group;
				current_header = child;
				visible_in_group = false;
			} else if (child.hasAttribute('data-file-path')) {
				if (!child.hidden) visible_in_group = true;
			}
		}
		if (current_header) current_header.hidden = needle !== '' && !visible_in_group;
	}

	function focusRow(popover, index) {
		const rows = currentRows(popover);
		if (rows.length === 0) {
			return;
		}

		const clamped = Math.max(0, Math.min(index < 0 ? 0 : index, rows.length - 1));
		for (const row of rows) {
			row.removeAttribute('data-focused');
		}
		rows[clamped].setAttribute('data-focused', 'true');
		rows[clamped].scrollIntoView({ block: 'nearest' });
	}

	function focusedIndex(popover) {
		return currentRows(popover).findIndex(function (row) {
			return row.dataset.focused === 'true';
		});
	}

	function syncPopoverUi(workspace, name) {
		if (!(workspace instanceof Element)) {
			return;
		}

		const popover = workspace.querySelector('[data-popover="' + name + '"]');
		if (!popover) {
			return;
		}

		const search = popover.querySelector('[data-popover-search]');
		if (search instanceof HTMLInputElement) {
			search.value = '';
			applyFilter(popover, '');
			search.focus();
			return;
		}

		focusRow(
			popover,
			currentRows(popover).findIndex(function (row) {
				return row.dataset.selected === 'true';
			})
		);
	}

	function createState() {
		if (workspace_state) {
			return workspace_state;
		}

		workspace_state = {
			open_popover: null,
			root: null,
			panelOpen: false,
			panelUrl: '',
			openPanel: function (url) {
				this.panelUrl = url;
				this.panelOpen = true;
			},
			closePanel: function () {
				this.panelUrl = '';
				this.panelOpen = false;
			},
			drawerOpen: false,
			openDrawer: function () {
				assistantState(this);
				this.drawerOpen = true;
				// Cheap liveness check so the composer can say "unreachable"
				// instead of letting the user type into a dead socket.
				this.probeAssistantHealth();
			},
			closeDrawer: function () {
				this.drawerOpen = false;
			},
			// ── Assistant chat ──
			// Markup, CSS classes and the /ui/message fragment contract are the
			// Python UI's own; this scope only carries the drawer state and the
			// transport, so answers render exactly as the assistant wrote them.
			assistantInput: '',
			assistantBusy: false,
			assistantRecording: false,
			assistantRetryIn: 0,
			assistantOnline: null,
			assistantMode: 'investigate',
			assistantSession: assistantSessionId(),
			// ── Planner debug ────────────────────────────────────
			// POST /plan?kind=qwen|laya answers {planner, plan_ms, tools[]} without
			// running anything. Debug only: it shows what the planner would call.
			assistantPlan: null,
			assistantPlanError: '',
			assistantPlanKind: 'qwen',
			toggleAssistantPlan: function () {
				const self = this;
				if (self.assistantPlan) {
					self.assistantPlan = null;
					return;
				}
				self.assistantPlanError = '';
				self.previewAssistantPlan();
			},
			previewAssistantPlan: function () {
				const self = this;
				const text = (self.assistantInput || '').trim();
				if (text === '') {
					assistantToast('Type a question first — the planner plans that', true);
					return;
				}
				const kind = self.assistantPlanKind === 'laya' ? 'laya' : 'qwen';
				window
					.fetch(ASSISTANT_BASE + '/plan?kind=' + kind, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ message: text })
					})
					.then(function (response) {
						return response.json().then(function (payload) {
							if (!response.ok) {
								throw new Error((payload && payload.detail) || 'HTTP ' + response.status);
							}
							return payload;
						});
					})
					.then(function (payload) {
						const tools = Array.isArray(payload.tools) ? payload.tools : [];
						self.assistantPlan = {
							kind: kind,
							planner: payload.planner || 'unknown',
							plan_ms: payload.plan_ms,
							tools: tools.map(function (entry) {
								return {
									tool: entry.tool,
									// Rendered as text, so template globals stay out of the markup.
									args_text: JSON.stringify(entry.args || {})
								};
							})
						};
						log('assistant:plan', { kind: kind, planner: payload.planner });
					})
					.catch(function (error) {
						log('assistant:plan-failed', error.message);
						self.assistantPlanError = 'planner unavailable: ' + error.message;
					});
			},
			// ── Level-2 actions ──────────────────────────────────
			// /actions lists what the assistant may do, /actions/request mints a
			// token + preview, /actions/confirm executes. Nothing is ever
			// executed on the user's behalf: the confirm button is the only path.
			assistantActions: null,
			assistantActionsError: '',
			assistantActionArgs: {},
			assistantActionPreview: null,
			assistantActionResult: '',
			toggleAssistantActions: function () {
				const self = this;
				if (self.assistantActions) {
					self.assistantActions = null;
					self.assistantActionPreview = null;
					return;
				}
				window
					.fetch(ASSISTANT_BASE + '/actions')
					.then(function (response) {
						if (!response.ok) {
							throw new Error('HTTP ' + response.status);
						}
						return response.json();
					})
					.then(function (payload) {
						self.assistantActions = {
							enabled: Boolean(payload && payload.enabled),
							catalog: Array.isArray(payload && payload.catalog) ? payload.catalog : [],
							pending: Array.isArray(payload && payload.pending) ? payload.pending : []
						};
						self.assistantActionsError = '';
					})
					.catch(function (error) {
						log('assistant:actions-failed', error.message);
						self.assistantActionsError = 'actions unavailable: ' + error.message;
					});
			},
			setAssistantActionArgs: function (name, event) {
				const value = event && event.target ? event.target.value : '';
				const next = Object.assign({}, this.assistantActionArgs);
				next[name] = value;
				this.assistantActionArgs = next;
			},
			requestAssistantAction: function (name) {
				const self = this;
				if (self.assistantActions && !self.assistantActions.enabled) {
					assistantToast('Actions are disabled on the assistant', true);
					return;
				}
				let args;
				try {
					args = JSON.parse(self.assistantActionArgs[name] || '{}');
				} catch (error) {
					assistantToast('args must be JSON: ' + error.message, true);
					return;
				}
				window
					.fetch(ASSISTANT_BASE + '/actions/request', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ tool: name, args: args })
					})
					.then(function (response) {
						return response.json().then(function (payload) {
							if (!response.ok) {
								throw new Error((payload && payload.detail) || 'HTTP ' + response.status);
							}
							return payload;
						});
					})
					.then(function (payload) {
						self.assistantActionPreview = payload;
						self.assistantActionResult = '';
						log('assistant:action-prepared', { action: name });
					})
					.catch(function (error) {
						log('assistant:action-request-failed', error.message);
						assistantToast('Could not prepare action: ' + error.message, true);
					});
			},
			confirmAssistantAction: function () {
				const self = this;
				const preview = self.assistantActionPreview;
				if (!preview || !preview.token) {
					assistantToast('Nothing to confirm', true);
					return;
				}
				window
					.fetch(ASSISTANT_BASE + '/actions/confirm', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ token: preview.token })
					})
					.then(function (response) {
						return response.json().then(function (payload) {
							if (!response.ok) {
								throw new Error((payload && payload.detail) || 'HTTP ' + response.status);
							}
							return payload;
						});
					})
					.then(function (payload) {
						self.assistantActionPreview = null;
						self.assistantActionResult = 'executed: ' + JSON.stringify(payload);
						log('assistant:action-confirmed', { action: preview.action });
					})
					.catch(function (error) {
						log('assistant:action-confirm-failed', error.message);
						self.assistantActionResult = 'failed: ' + error.message;
					});
			},
			dismissAssistantAction: function () {
				this.assistantActionPreview = null;
				this.assistantActionResult = '';
			},
			newAssistantSession: function () {
				if (this.assistantBusy) {
					assistantToast('Wait for the current answer first', true);
					return;
				}
				this.assistantSession = rotateAssistantSessionId();
				this.assistantMetrics = null;
				this.assistantMetricsError = '';
				const thread = document.querySelector('[data-assistant-thread]');
				if (thread) {
					thread.replaceChildren();
				}
				clearAssistantTranscript();
				log('assistant:new-session', { session: this.assistantSession });
				assistantToast('New session');
			},
			assistantMetrics: null,
			assistantMetricsError: '',
			toggleAssistantMetrics: function () {
				const self = this;
				if (self.assistantMetrics) {
					self.assistantMetrics = null;
					return;
				}
				window
					.fetch(ASSISTANT_BASE + '/metrics')
					.then(function (response) {
						if (!response.ok) {
							throw new Error('HTTP ' + response.status);
						}
						return response.text();
					})
					.then(function (text) {
						self.assistantMetrics = parseAssistantMetrics(text);
						self.assistantMetricsError = '';
					})
					.catch(function (error) {
						log('assistant:metrics-failed', error.message);
						self.assistantMetricsError = 'metrics unavailable: ' + error.message;
					});
			},
			// ── Simple fallback ──────────────────────────────────
			// Embed the assistant's own page same-origin and steal its links into
			// the panel. No re-drawing at all: this is the Python UI itself.
			assistantFallback: false,
			assistantFallbackReason: '',
			enableAssistantFallback: function (reason) {
				if (this.assistantFallback) {
					return;
				}
				this.assistantFallback = true;
				this.assistantFallbackReason = reason || '';
				log('assistant:fallback-on', { reason: reason });
				assistantToast('Showing the assistant’s own page (' + (reason || 'manual') + ')');
			},
			useAssistantFallback: function () {
				this.enableAssistantFallback('manual');
			},
			bindAssistantFrame: function () {
				const frame = document.querySelector('[data-assistant-frame]');
				const doc = frame && frame.contentDocument;
				if (!doc) {
					log('assistant:frame-cross-origin');
					assistantToast('Embedded assistant is not same-origin — links will open tabs', true);
					return;
				}

				for (const anchor of doc.querySelectorAll('a[target]')) {
					anchor.removeAttribute('target');
				}

				doc.addEventListener(
					'click',
					function (event) {
						const target = event.target instanceof Element ? event.target : null;
						const link = target ? target.closest('a[href]') : null;
						if (!link) {
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						workspace_state?.openAssistantLink(link.href || link.getAttribute('href'));
					},
					true
				);

				log('assistant:frame-bound');
			},
			probeAssistantHealth: function () {
				const self = this;
				window
					.fetch(ASSISTANT_BASE + '/healthz')
					.then(function (response) {
						if (!response.ok) {
							throw new Error('HTTP ' + response.status);
						}
						return response.json();
					})
					.then(function (payload) {
						self.assistantOnline = true;
						log('assistant:health-ok', payload && payload.status);
					})
					.catch(function (error) {
						self.assistantOnline = false;
						log('assistant:health-failed', error && error.message);
					});
			},
			toggleAssistantRecording: function () {
				const self = this;
				if (assistant_recorder) {
					assistant_recorder.stop();
					return;
				}

				const media = navigator.mediaDevices;
				if (!media || typeof window.MediaRecorder !== 'function') {
					assistantToast('Recording is not available in this browser', true);
					return;
				}

				media
					.getUserMedia({ audio: true })
					.then(function (stream) {
						startAssistantRecorder(stream, self);
					})
					.catch(function (error) {
						log('assistant:mic-failed', error && error.message);
						assistantToast('Microphone unavailable: ' + ((error && error.message) || error), true);
					});
			},
			openAssistantLink: function (url) {
				// Deep links (Grafana/Hubble/Neo4j evidence) open inside the panel
				// — never a new tab, and never a non-navigable scheme.
				if (!url || !/^(https?:\/\/|\/)/i.test(url)) {
					log('assistant:unsupported-link', { url: url });
					return;
				}
				const state = assistantState(this);
				state.closeDrawer();
				state.openPanel(url);
			},
			cancelAssistantQuestion: function () {
				if (!assistant_abort) {
					return;
				}
				assistant_abort.abort();
				assistantToast('Stopped waiting — the assistant may still finish server-side');
			},
			sendAssistant: function () {
				assistantState(this);
				const text = (this.assistantInput || '').trim();
				if (text === '' || this.assistantBusy) {
					return;
				}
				this.assistantInput = '';
				this.deliverAssistantQuestion(text, 0);
			},
			// One question, one pending bubble, one answer. `attempt` exists only
			// for the 429 path: the assistant's limiter answers 429 + Retry-After
			// when it is saturated, and the question is retried once after waiting.
			deliverAssistantQuestion: function (text, attempt) {
				const self = this;
				const thread = document.querySelector('[data-assistant-thread]');
				if (!thread) {
					log('assistant:missing-thread');
					return;
				}

				self.assistantBusy = true;

				if (attempt === 0) {
					const user = document.createElement('div');
					user.className = 'msg user';
					user.textContent = text;
					thread.appendChild(user);
					rememberAssistantQuestion(text);
				}

				const pending = document.createElement('div');
				pending.className = 'msg bot pending';
				pending.innerHTML = 'thinking&hellip; <b>0.0</b>s';
				thread.appendChild(pending);
				thread.scrollTop = thread.scrollHeight;

				const started = performance.now();
				const tick = window.setInterval(function () {
					const elapsed = pending.querySelector('b');
					if (elapsed) {
						elapsed.textContent = ((performance.now() - started) / 1000).toFixed(1);
					}
				}, 100);

				const body = new URLSearchParams();
				body.set('message', text);
				body.set('mode', self.assistantMode);
				body.set('session', self.assistantSession);

				function settle() {
					window.clearInterval(tick);
					assistant_abort = null;
					self.assistantBusy = false;
					thread.scrollTop = thread.scrollHeight;
				}

				function busyMessage(seconds) {
					pending.textContent = 'assistant busy — retry in ' + seconds + 's';
				}

				assistant_abort = typeof window.AbortController === 'function' ? new window.AbortController() : null;

				window
					.fetch(ASSISTANT_BASE + '/ui/message', {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: body,
						signal: assistant_abort ? assistant_abort.signal : undefined
					})
					.then(function (response) {
						if (response.status === 429) {
							const header = response.headers && typeof response.headers.get === 'function'
								? Number(response.headers.get('Retry-After'))
								: NaN;
							const error = new Error('429 too many requests');
							error.retry_after = Number.isFinite(header) && header > 0 ? Math.ceil(header) : 5;
							throw error;
						}
						if (!response.ok) {
							throw new Error('HTTP ' + response.status);
						}
						return response.text();
					})
					.then(function (fragment) {
						window.clearInterval(tick);
						rememberAssistantAnswer(fragment);
						const holder = document.createElement('div');
						holder.innerHTML = fragment;
						rewriteAssistantUrls(holder);
						while (holder.firstChild) {
							pending.parentNode.insertBefore(holder.firstChild, pending);
						}
						pending.remove();
						settle();
						self.assistantOnline = true;
					})
					.catch(function (error) {
						if (error && error.name === 'AbortError') {
							window.clearInterval(tick);
							log('assistant:cancelled');
							pending.className = 'msg bot pending';
							pending.textContent = 'cancelled';
							rememberAssistantError('cancelled');
							settle();
							return;
						}
						if (error && error.retry_after) {
							window.clearInterval(tick);
							self.assistantRetryIn = error.retry_after;
							busyMessage(self.assistantRetryIn);
							log('assistant:busy', { retry_in: error.retry_after, attempt: attempt });

							const countdown = window.setInterval(function () {
								self.assistantRetryIn = Math.max(0, self.assistantRetryIn - 1);
								busyMessage(self.assistantRetryIn);
							}, 1000);

							window.setTimeout(function () {
								window.clearInterval(countdown);
								self.assistantRetryIn = 0;
								if (attempt === 0) {
									pending.remove();
									self.assistantBusy = false;
									assistantToast('Assistant was busy — retrying');
									self.deliverAssistantQuestion(text, 1);
									return;
								}
								// Second 429: stop retrying and give the question back.
								self.assistantInput = text;
								pending.className = 'msg bot err';
								pending.textContent = 'assistant still busy (429) — press Send to retry';
								assistantToast('Assistant still busy (429) — question restored', true);
								settle();
							}, error.retry_after * 1000);
							return;
						}

						window.clearInterval(tick);
						log('assistant failed', error.message);
						const status = /^HTTP (\d+)$/.exec(error.message);
						if (status && ['404', '405', '501'].includes(status[1])) {
							self.enableAssistantFallback('fragment endpoint unusable: ' + error.message);
						}
						pending.className = 'msg bot err';
						pending.textContent = 'Request failed: ' + error.message;
						rememberAssistantError('Request failed: ' + error.message);
						assistantToast('Request failed', true);
						settle();
					});
			},
			tmuxOpen: false,
			archOpen: false,
			toggleArch: function () {
				var self = this;
				var panel = document.querySelector('.ide-panel');
				var right = document.querySelector('.ide-preview-island--right');
				var archPanel = document.querySelector('.arch-panel');
				var shell = document.querySelector('.ide-shell');

				if (!panel || !right || !archPanel || !shell) {
					self.archOpen = !self.archOpen;
					return;
				}

				var opening = !self.archOpen;

				if (opening) {
					self.archOpen = true;
					shell.classList.add('is-arch');
					if (window.FuwaShellMotion && typeof window.FuwaShellMotion.loadMermaid === 'function') {
						window.FuwaShellMotion.loadMermaid();
					}
				}

				if (window.gsap) {
					var tl = window.gsap.timeline({
						onComplete: function () {
							if (!opening) {
								self.archOpen = false;
								shell.classList.remove('is-arch');
							}
						}
					});

					if (opening) {
						tl.to([panel, right], { opacity: 0, x: -20, duration: 0.25, ease: 'power2.in', stagger: 0.04 }, 0);
						tl.fromTo(archPanel, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' }, 0.08);
					} else {
						self.archOpen = false;
						shell.classList.remove('is-arch');
						tl.to(archPanel, { opacity: 0, scale: 0.97, duration: 0.2, ease: 'power2.in' }, 0);
						tl.fromTo([panel, right], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.28, ease: 'power2.out', stagger: 0.04 }, 0.06);
					}
				} else {
					self.archOpen = !self.archOpen;
				}
			},
			toggleTmux: function () {
				var self = this;
				var panel = document.querySelector('.ide-panel');
				var right = document.querySelector('.ide-preview-island--right');
				var tmuxPanel = document.querySelector('.tmux-panel');
				var shell = document.querySelector('.ide-shell');

				if (!panel || !right || !tmuxPanel || !shell) {
					self.tmuxOpen = !self.tmuxOpen;
					return;
				}

				var opening = !self.tmuxOpen;

				if (opening) {
					self.tmuxOpen = true;
					shell.classList.add('is-tmux');
					setTimeout(function () {
						if (window.FuwaShellTmux) window.FuwaShellTmux.mountAll();
					}, 200);
				}

				if (window.gsap) {
					var tl = window.gsap.timeline({
						onComplete: function () {
							if (!opening) {
								self.tmuxOpen = false;
								shell.classList.remove('is-tmux');
							}
						}
					});

					if (opening) {
						tl.to([panel, right], { opacity: 0, x: -20, duration: 0.25, ease: 'power2.in', stagger: 0.04 }, 0);
						tl.fromTo(tmuxPanel, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' }, 0.08);
					} else {
						self.tmuxOpen = false;
						shell.classList.remove('is-tmux');
						tl.to(tmuxPanel, { opacity: 0, scale: 0.97, duration: 0.2, ease: 'power2.in' }, 0);
						tl.fromTo([panel, right], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.28, ease: 'power2.out', stagger: 0.04 }, 0.06);
					}
				} else {
					self.tmuxOpen = !self.tmuxOpen;
				}
			},
			openPalette: function () {
				const workspace = document.querySelector('[data-workspace]');
				if (!(workspace instanceof Element)) {
					return;
				}
				this.root = workspace;
				active_state = this;
				this.open_popover = 'files';
				queueMicrotask(function () {
					syncPopoverUi(workspace, 'files');
				});
			},
			togglePopover(name, event) {
				const workspace = workspaceRoot(event && event.currentTarget);
				if (!(workspace instanceof Element)) {
					log('popover-toggle:missing-workspace', { name: name });
					return;
				}

				log('popover-toggle:start', {
					name: name,
					open: this.open_popover,
					workspace: describeScope(workspace)
				});
				this.root = workspace;
				active_state = this;
				if (this.open_popover === name) {
					log('popover-toggle:close-self', { name: name });
					this.closePopover('toggle');
					return;
				}

				this.open_popover = name;
				log('popover-toggle:open', { name: name });
				queueMicrotask(function () {
					log('popover-toggle:sync-ui', { name: name });
					syncPopoverUi(workspace, name);
				});
			},
			closePopover(reason) {
				log('popover-close', {
					reason: reason || 'manual',
					open: this.open_popover,
					workspace: describeScope(this.root)
				});
				this.open_popover = null;
				if (active_state === this) {
					active_state = null;
				}
				if (!(this.root instanceof Element)) {
					this.root = null;
					return;
				}
				for (const row of this.root.querySelectorAll('[data-file-path]')) {
					row.removeAttribute('data-focused');
				}
				this.root = null;
			}
		};

		return workspace_state;
	}

	document.addEventListener('click', function (event) {
		const target = event.target instanceof Element ? event.target : null;
		if (!target) {
			return;
		}

		const workspace = active_state && active_state.root instanceof Element ? active_state.root : null;
			if (!workspace) {
				log('outside-click:no-active-popover');
				return;
			}

			if (target.closest('[data-popover]') || target.closest('[data-popover-toggle]')) {
				log('outside-click:ignored-inside-popover', {
					target: target.tagName.toLowerCase()
				});
				return;
			}

			if (!workspace.contains(target)) {
				log('outside-click:close-popover', { workspace: describeScope(workspace) });
				active_state.closePopover('outside-click');
				return;
			}

			log('outside-click:close-popover-in-workspace', { workspace: describeScope(workspace) });
			active_state.closePopover('workspace-click');
		},
		true
	);

	// Assistant fragments: 🔊 audio, copy buttons, and evidence deep links.
	// Rule: nothing in the drawer may open a browser tab. Every anchor — click,
	// middle-click or ⌘/Ctrl-click — resolves into the fuwa panel instead.

	function assistantAnchor(event) {
		const target = event.target instanceof Element ? event.target : null;
		if (!target || !target.closest('.assistant-drawer')) {
			return null;
		}
		return target.closest('a[href]');
	}

	function openAssistantAnchor(event) {
		const link = assistantAnchor(event);
		if (!link) {
			return false;
		}
		event.preventDefault();
		event.stopPropagation();
		workspace_state?.openAssistantLink(link.href || link.getAttribute('href'));
		return true;
	}

	document.addEventListener('click', function (event) {
		const target = event.target instanceof Element ? event.target : null;
		if (!target) {
			return;
		}

		const speak = target.closest('button.speak');
		if (speak) {
			toggleAssistantSpeech(speak);
			return;
		}

		const copy = target.closest('button.copy');
		if (copy) {
			copyAssistantText(copy);
			return;
		}

		openAssistantAnchor(event);
	});

	// Middle-click opens a new tab by default too.
	document.addEventListener('auxclick', function (event) {
		if (event.button === 1) {
			openAssistantAnchor(event);
		}
	});

	document.addEventListener('input', function (event) {
		const input = event.target;
		if (!(input instanceof HTMLInputElement) || !input.matches('[data-popover-search]')) {
			return;
		}

		const popover = input.closest('[data-popover]');
		if (popover) {
			applyFilter(popover, input.value);
		}
	});

	document.addEventListener('change', function (event) {
		const select = event.target;
		if (!(select instanceof HTMLSelectElement) || !select.matches('[data-switch-select]')) {
			return;
		}

		const route = select.value || '';
		if (route === '' || !(window.htmx && typeof window.htmx.ajax === 'function')) {
			return;
		}

		window.htmx.ajax('POST', route, {
			target: '#shell-content',
			swap: 'outerHTML'
		});
	});

	document.addEventListener('keydown', function (event) {
		if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && String(event.key).toLowerCase() === 'k') {
			event.preventDefault();
			createState().openPalette();
			return;
		}

		if (event.key === 'Escape') {
			active_state?.closePopover();
			return;
		}

		const target = event.target instanceof Element ? event.target : null;
		const popover = target ? target.closest('[data-popover]') : null;
		if (!popover) {
			return;
		}

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			focusRow(popover, focusedIndex(popover) + delta);
			return;
		}

		if (event.key === 'Enter') {
			const rows = currentRows(popover);
			const focused = rows[focusedIndex(popover)] || rows[0];
			if (focused && target instanceof HTMLInputElement) {
				event.preventDefault();
				focused.click();
			}
		}
	});

	function initialize(scope) {
		const target = resolveScope(scope, 'initialize');
		for (const select of target.querySelectorAll('[data-switch-select]')) {
			const current = select.getAttribute('data-switch-current') || '';
			if (current !== '') {
				select.value = current;
			}
		}
		log('initialize', { scope: describeScope(target) });
	}

	function dependenciesReady() {
		return window.PetiteVue && typeof window.PetiteVue.createApp === 'function';
	}

	function mount(scope) {
		const target = resolveScope(scope, 'mount');
		if (!(target instanceof Element)) {
			return;
		}

		if (mounted_roots.has(target)) {
			log('mount:already-mounted', describeScope(target));
			return;
		}

		if (window.PetiteVue && typeof window.PetiteVue.createApp === 'function') {
			try {
				log('mount:start', describeScope(target));
				if (mounted_app) {
					mounted_app.unmount();
				}
				mounted_app = window.PetiteVue.createApp({ scope: workspace_state }).mount(target);
				rememberMounted(target);
				log('mount:complete', describeScope(target));
			} catch (error) {
				console.error(LOG_PREFIX + ' petite-vue mount failed', error);
			}
		}
	}

	function boot() {
		log('boot:start');
		const shell = document.querySelector('.ide-shell') || document.body || document;
		initialize(shell);

		if (!dependenciesReady()) {
			if (!retry_timer) {
				log('boot:waiting-for-dependencies');
				retry_timer = setTimeout(function () {
					retry_timer = null;
					boot();
				}, 16);
			}
			return;
		}

		if (booted) {
			return;
		}

		booted = true;
		log('boot:mount-shell', describeScope(shell));
		mount(shell);
	}

	workspace_state = createState();

	window.FuwaShellWorkspace = {
		createState,
		state: workspace_state,
		initialize,
		parseAssistantMetrics,
		assistantProxyUrl
	};

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			function () {
				boot();
			},
			{ once: true }
		);
	} else {
		boot();
	}

	document.addEventListener('htmx:afterSwap', function (event) {
		const raw_scope = event.detail?.target || event.detail?.elt || event.target || document.body;
		if (raw_scope instanceof Element && (raw_scope.id === 'shell-content' || raw_scope.matches('[data-workspace]'))) {
			active_state?.closePopover('swap');
		}

		const target = raw_scope instanceof Element && raw_scope.id === 'shell-content'
			? document.querySelector('.ide-shell') || document.body || document
			: document.querySelector('[data-workspace]') || document.querySelector('.ide-shell') || document.body || document;
		active_state = workspace_state;
		log('afterSwap', {
			raw: describeScope(raw_scope),
			resolved: describeScope(target)
		});
		initialize(target);
		mount(target);
		restoreAssistantTranscript();
	});
})();
