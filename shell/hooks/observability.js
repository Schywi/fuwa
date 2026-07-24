(function () {
	'use strict';

	const LOG_PREFIX = '[shell:obs]';
	const ROOT_SELECTOR = '[data-obs-root]';
	const POLL_MS = 5000;
	const CLOCK_MS = 1000;
	const MAX_EVENTS = 200;
	let app = null;
	let poll_timer = null;
	let clock_timer = null;
	let live_source = null;
	let state = null;
	let raw_events = [];
	let last_event_at = 0;
	let last_event_key = '';

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	function describeRoot(root) {
		if (!(root instanceof Element)) {
			return null;
		}

		return {
			tag: root.tagName.toLowerCase(),
			id: root.id || null,
			view: root.getAttribute('data-view') || null,
			hidden: root.hidden
		};
	}

	function resolveScope(scope, reason) {
		var target = scope && typeof scope.querySelectorAll === 'function' ? scope : document.body || document;
		if (target instanceof Element && document.contains(target)) {
			return target;
		}

		var fallback = document.querySelector(ROOT_SELECTOR) || document.body || document;
		if (target instanceof Element) {
			log(reason + ':fallback', { raw: describeRoot(target), fallback: describeRoot(fallback) });
		}
		return fallback;
	}

	function createState() {
		return {
			vector: { up: false, latencyMs: 0 },
			vm: { up: false, latencyMs: 0 },
			clickhouse: { up: false, latencyMs: 0 },
			uptrace: { up: false, latencyMs: 0 },
			reqCount: '--',
			errorRate: '--',
			p95Label: '--',
			lastEventLabel: 'idle',
			streamLabel: 'offline',
			bufferedCount: 0,
			requests: [],
			selectedTraceId: '',
			selectedRequest: null,
			healthClass: function (svc) {
				return svc.up ? 'health-up' : 'health-down';
			},
			healthIcon: function (svc) {
				return svc.up ? '\u25c9' : '\u25ce';
			},
			requestTone: function (request) {
				if (!request) return 'idle';
				return request.failed || request.status >= 400 ? 'error' : 'ok';
			},
			isSelected: function (request) {
				return !!request && request.traceId === this.selectedTraceId;
			},
			selectRequest: function (request) {
				if (!request) return;
				this.selectedTraceId = request.traceId;
				this.selectedRequest = request;
			}
		};
	}

	function fetchOK(url, timeout) {
		timeout = timeout || 2000;
		return fetch(url, { signal: AbortSignal.timeout(timeout) }).then(function (response) {
			if (!response.ok) {
				throw new Error(response.status + ' ' + response.statusText);
			}
		});
	}

	function fetchJSON(url, timeout) {
		timeout = timeout || 2000;
		return fetch(url, { signal: AbortSignal.timeout(timeout) }).then(function (response) {
			if (!response.ok) {
				throw new Error(response.status + ' ' + response.statusText);
			}
			return response.json();
		});
	}

	function roundMs(value) {
		return typeof value === 'number' && !isNaN(value) ? Math.round(value) : null;
	}

	function formatMs(value) {
		var rounded = roundMs(value);
		return rounded == null ? '--' : String(rounded) + 'ms';
	}

	function formatRelative(now, then) {
		if (!then) {
			return 'idle';
		}

		var delta = Math.max(0, Math.round((now - then) / 1000));
		if (delta <= 1) {
			return 'just now';
		}
		if (delta < 60) {
			return String(delta) + 's ago';
		}

		var minutes = Math.floor(delta / 60);
		return String(minutes) + 'm ago';
	}

	function trimText(value, size) {
		var text = String(value || '--');
		if (text.length <= size) {
			return text;
		}
		return text.slice(0, size - 1) + '\u2026';
	}

	function summarizeAttrs(attrs, keys) {
		var parts = [];
		for (var i = 0; i < keys.length; i++) {
			var key = keys[i];
			if (attrs[key] == null) {
				continue;
			}
			parts.push(key + '=' + String(attrs[key]));
		}
		return parts.join(' ');
	}

	function formatEventLine(event) {
		var attrs = event.attrs || {};
		if (event.kind === 'span_start') {
			return '\u25b6 ' + event.name + ' ' + summarizeAttrs(attrs, ['method', 'path', 'files', 'bytes']);
		}
		if (event.kind === 'span_log') {
			return '\u00b7 ' + trimText(event.message || 'event', 52) + ' ' + summarizeAttrs(event.fields || {}, ['count', 'files', 'path']);
		}
		if (event.kind === 'span_end') {
			return '\u25c0 ' + event.name + ' ' + formatMs(event.duration_ms) + ' ' + summarizeAttrs(attrs, ['files', 'modules', 'bytes', 'method', 'path']);
		}
		if (event.kind === 'request') {
			return '\u25c0 request ' + String(event.method || '--') + ' ' + String(event.path || '--') + ' status=' + String(event.status || '--') + ' ' + formatMs(event.duration_ms);
		}
		return trimText(JSON.stringify(event), 72);
	}

	function captureStage(summary, event) {
		var attrs = event.attrs || {};
		var label = {
			name: event.name,
			duration: formatMs(event.duration_ms),
			detail: summarizeAttrs(attrs, ['files', 'modules', 'bytes', 'method', 'path'])
		};

		if (event.name === 'compile') {
			summary.compileLabel = label.duration;
		}
		if (event.name === 'render') {
			summary.renderLabel = label.duration;
		}

		summary.stages.push(label);
	}

	function createSummary(trace_id) {
		return {
			traceId: trace_id,
			method: '--',
			path: '--',
			status: 0,
			statusLabel: '--',
			durationMs: null,
			durationLabel: '--',
			stageSummary: 'awaiting request completion',
			compileLabel: '--',
			renderLabel: '--',
			failed: false,
			stages: [],
			logs: [],
			finalized: false,
			order: 0
		};
	}

	function rebuildRequests() {
		var by_trace = {};
		var order = 0;

		for (var i = 0; i < raw_events.length; i++) {
			var event = raw_events[i];
			var trace_id = event.trace_id;
			if (!trace_id) {
				continue;
			}

			var summary = by_trace[trace_id];
			if (!summary) {
				summary = createSummary(trace_id);
				by_trace[trace_id] = summary;
			}

			summary.order = i;
			if (summary.logs.length < 16) {
				summary.logs.push(formatEventLine(event));
			}

			if (event.kind === 'span_start' && event.name === 'request') {
				var start_attrs = event.attrs || {};
				summary.method = String(start_attrs.method || summary.method || '--');
				summary.path = String(start_attrs.path || summary.path || '--');
			}

			if (event.kind === 'span_end') {
				captureStage(summary, event);
			}

			if (event.kind === 'request') {
				summary.finalized = true;
				summary.method = String(event.method || summary.method || '--');
				summary.path = String(event.path || summary.path || '--');
				summary.status = Number(event.status || 0);
				summary.statusLabel = String(event.status || '--');
				summary.durationMs = event.duration_ms;
				summary.durationLabel = formatMs(event.duration_ms);
				summary.failed = !!event.failed;
			}
			order += 1;
		}

		var requests = [];
		for (var trace_id_key in by_trace) {
			if (!Object.prototype.hasOwnProperty.call(by_trace, trace_id_key)) {
				continue;
			}

			var request = by_trace[trace_id_key];
			if (!request.finalized) {
				continue;
			}

			var stage_parts = [];
			if (request.compileLabel !== '--') {
				stage_parts.push('compile ' + request.compileLabel);
			}
			if (request.renderLabel !== '--') {
				stage_parts.push('render ' + request.renderLabel);
			}
			if (stage_parts.length === 0) {
				stage_parts.push('request complete');
			}
			request.stageSummary = stage_parts.join(' \u00b7 ');
			requests.push(request);
		}

		requests.sort(function (left, right) {
			return right.order - left.order;
		});

		if (requests.length > 50) {
			requests = requests.slice(0, 50);
		}

		var selected = null;
		for (var j = 0; j < requests.length; j++) {
			if (requests[j].traceId === state.selectedTraceId) {
				selected = requests[j];
				break;
			}
		}
		if (!selected) {
			selected = requests[0] || null;
		}

		var durations = [];
		var failed = 0;
		for (var k = 0; k < requests.length; k++) {
			if (typeof requests[k].durationMs === 'number' && !isNaN(requests[k].durationMs)) {
				durations.push(requests[k].durationMs);
			}
			if (requests[k].failed || requests[k].status >= 400) {
				failed += 1;
			}
		}
		durations.sort(function (left, right) {
			return left - right;
		});

		state.requests = requests;
		state.reqCount = String(requests.length);
		state.errorRate = requests.length === 0 ? '--' : (failed / requests.length * 100).toFixed(1) + '%';
		if (durations.length === 0) {
			state.p95Label = '--';
		} else {
			var idx = Math.ceil(durations.length * 0.95) - 1;
			if (idx < 0) idx = 0;
			state.p95Label = formatMs(durations[idx]);
		}
		state.selectedRequest = selected;
		state.selectedTraceId = selected ? selected.traceId : '';
		state.bufferedCount = raw_events.length;
	}

	function updateClock() {
		if (!state) {
			return;
		}
		state.lastEventLabel = formatRelative(Date.now(), last_event_at);
	}

	function replaceEvents(events) {
		var next_events = Array.isArray(events) ? events.slice(-MAX_EVENTS) : [];
		var latest = next_events.length > 0 ? next_events[next_events.length - 1] : null;
		var latest_key = latest ? JSON.stringify(latest) : '';
		raw_events = next_events;
		if (latest_key !== '' && latest_key !== last_event_key) {
			last_event_key = latest_key;
			last_event_at = Date.now();
		}
		rebuildRequests();
		updateClock();
	}

	function appendEvent(event) {
		raw_events.push(event);
		if (raw_events.length > MAX_EVENTS) {
			raw_events = raw_events.slice(-MAX_EVENTS);
		}
		last_event_key = JSON.stringify(event);
		last_event_at = Date.now();
		rebuildRequests();
		updateClock();
	}

	function pollHealth() {
		var services = [
			{ key: 'vector', url: '/__dev/proxy/vector/health' },
			{ key: 'vm', url: '/__dev/proxy/vm/health' },
			{ key: 'clickhouse', url: '/__dev/proxy/clickhouse/ping' },
			{ key: 'uptrace', url: '/__dev/proxy/uptrace/' }
		];

		services.forEach(function (svc) {
			var started = performance.now();
			fetchOK(svc.url).then(function () {
				state[svc.key].up = true;
				state[svc.key].latencyMs = Math.round(performance.now() - started);
			}).catch(function () {
				state[svc.key].up = false;
				state[svc.key].latencyMs = 0;
			});
		});
	}

	function syncTraceSnapshot() {
		return fetchJSON('/__dev/traces').then(function (data) {
			if (data && Array.isArray(data.traces)) {
				replaceEvents(data.traces);
			}
		}).catch(function () {
			state.streamLabel = live_source ? 'reconnecting' : 'offline';
		});
	}

	function closeLiveStream() {
		if (live_source) {
			live_source.close();
			live_source = null;
		}
	}

	function connectLiveStream() {
		closeLiveStream();
		if (typeof EventSource !== 'function') {
			state.streamLabel = 'polling only';
			return;
		}

		live_source = new EventSource('/__dev/traces/live');
		state.streamLabel = 'connecting';

		live_source.addEventListener('ready', function () {
			state.streamLabel = 'live';
		});

		live_source.addEventListener('trace', function (event) {
			state.streamLabel = 'live';
			try {
				appendEvent(JSON.parse(event.data));
			} catch (_error) {
				state.streamLabel = 'stream parse error';
			}
		});

		live_source.onerror = function () {
			state.streamLabel = 'reconnecting';
		};
	}

	function startLoops() {
		if (poll_timer) {
			clearInterval(poll_timer);
		}
		if (clock_timer) {
			clearInterval(clock_timer);
		}

		poll_timer = setInterval(function () {
			pollHealth();
			syncTraceSnapshot();
		}, POLL_MS);

		clock_timer = setInterval(function () {
			updateClock();
		}, CLOCK_MS);
	}

	function stopLoops() {
		if (poll_timer) {
			clearInterval(poll_timer);
			poll_timer = null;
		}
		if (clock_timer) {
			clearInterval(clock_timer);
			clock_timer = null;
		}
		closeLiveStream();
	}

	function mount(root) {
		if (!(root instanceof Element) || root.hidden) {
			return;
		}

		if (!state) {
			state = createState();
		}

		stopLoops();

		root.removeAttribute('v-pre');
		if (app) {
			app.unmount();
			app = null;
		}

		if (!(window.PetiteVue && window.PetiteVue.createApp)) {
			log('petite-vue not ready, retrying');
			setTimeout(function () { mount(root); }, 200);
			return;
		}

		app = window.PetiteVue.createApp(state);
		app.mount(root);
		root.setAttribute('data-widget-state', 'mounted');
		root.setAttribute('data-widget-kind', 'observability');

		pollHealth();
		syncTraceSnapshot().finally(function () {
			connectLiveStream();
			startLoops();
		});
		log('mount:success', describeRoot(root));
	}

	function unmount(root) {
		stopLoops();
		if (app) {
			app.unmount();
			app = null;
		}

		if (root instanceof Element) {
			root.removeAttribute('data-widget-state');
			root.removeAttribute('data-widget-kind');
		}

		if (state) {
			state.streamLabel = 'paused';
		}
		log('unmount', describeRoot(root));
	}

	function forEachRoot(scope, fn) {
		var target = resolveScope(scope, 'scope');
		if (target instanceof Element && target.matches(ROOT_SELECTOR)) {
			fn(target);
		}

		var roots = target.querySelectorAll(ROOT_SELECTOR);
		for (var i = 0; i < roots.length; i++) {
			if (roots[i] !== target) {
				fn(roots[i]);
			}
		}
	}

	function refresh(scope) {
		log('refresh', { scope: describeRoot(scope) });
		forEachRoot(scope, function (root) {
			if (!root.hidden) {
				mount(root);
			}
		});
	}

	function clearRoots(scope) {
		forEachRoot(scope, function (root) {
			unmount(root);
		});
	}

	function handleBeforeSwap(event) {
		var scope = event.detail?.target || event.detail?.elt || event.target || document.body;
		log('htmx:beforeSwap', {
			raw: describeRoot(scope),
			status: event.detail?.xhr?.status || null
		});
		clearRoots(scope);
	}

	function handleAfterSwap(event) {
		var scope = event.detail?.target || event.detail?.elt || event.target || document.body;
		log('htmx:afterSwap', {
			raw: describeRoot(scope),
			status: event.detail?.xhr?.status || null
		});
		refresh(scope);
	}

	window.FuwaShellObservability = {
		mount: mount,
		unmount: unmount,
		refresh: refresh,
		selector: ROOT_SELECTOR
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () {
			log('boot:DOMContentLoaded');
			refresh(document.body || document);
		}, { once: true });
	} else {
		log('boot:ready');
		refresh(document.body || document);
	}

	document.addEventListener('htmx:beforeSwap', handleBeforeSwap);
	document.addEventListener('htmx:afterSwap', handleAfterSwap);
})();
