(function () {
	'use strict';

	const ROOT_SELECTOR = '[data-obs-root]';
	const MAX_EVENTS = 200;
	let app = null;
	let liveSource = null;
	let state = null;
	let rawEvents = [];

	function createState() {
		return {
			requests: [],
			expandedTraceId: '',
			streamLabel: 'connecting',
			toggleExpand: function (req) {
				this.expandedTraceId = this.expandedTraceId === req.traceId ? '' : req.traceId;
			},
			statusTone: function (req) {
				return req && (req.failed || req.status >= 400) ? 'error' : 'ok';
			}
		};
	}

	function formatMs(v) {
		return typeof v === 'number' && !isNaN(v) ? Math.round(v) + 'ms' : '--';
	}

	function summarizeAttrs(attrs, keys) {
		var parts = [];
		for (var i = 0; i < keys.length; i++) {
			var k = keys[i];
			if (attrs[k] != null) parts.push(k + '=' + String(attrs[k]));
		}
		return parts.join(' ');
	}

	function formatEventLine(event) {
		// Returns {label, tone} — label is the display string, tone is
		// optional 'error' for highlighting failed/error events.
		var attrs = event.attrs || {};
		var label, tone;
		if (event.kind === 'span_start') {
			label = '\u25b6 ' + event.name + ' ' + summarizeAttrs(attrs, ['method', 'path', 'files', 'bytes']);
		} else if (event.kind === 'span_log') {
			var msg = String(event.message || 'event');
			var fields = event.fields || {};
			label = '\u00b7 ' + msg + ' ' + summarizeAttrs(fields, Object.keys(fields));
			if (fields.error || fields.failed) tone = 'error';
		} else if (event.kind === 'span_end') {
			label = '\u25c0 ' + event.name + ' ' + formatMs(event.duration_ms) + ' ' + summarizeAttrs(attrs, Object.keys(attrs));
			if (event.failed) tone = 'error';
			if (event.error) label += ' error=' + String(event.error);
		} else if (event.kind === 'request') {
			label = '\u25c0 request ' + String(event.method || '--') + ' ' + String(event.path || '--') + ' status=' + String(event.status || '--') + ' ' + formatMs(event.duration_ms);
			if (event.failed) tone = 'error';
			if (event.error) label += ' error=' + String(event.error);
		} else {
			label = JSON.stringify(event);
		}
		return { label: label, tone: tone };
	}

	function rebuildRequests() {
		if (!state) return;
		var byTrace = {};
		for (var i = 0; i < rawEvents.length; i++) {
			var ev = rawEvents[i];
			var tid = ev.trace_id;
			if (!tid) continue;

			var req = byTrace[tid];
			if (!req) {
				req = { traceId: tid, method: '--', path: '--', status: 0, statusLabel: '--',
					durationMs: null, durationLabel: '--', stageSummary: '', failed: false,
					stages: [], logs: [], finalized: false, maxTs: 0 };
				byTrace[tid] = req;
			}
			// Track the latest _ts for sorting (fallback to 0 for old events without _ts).
			var ts = typeof ev._ts === 'number' ? ev._ts : 0;
			if (ts > req.maxTs) req.maxTs = ts;

			if (req.logs.length < 32) {
				var fl = formatEventLine(ev);
				req.logs.push({ kind: ev.kind, label: fl.label, ts: ts, tone: fl.tone || null });
			}

			if (ev.kind === 'span_start' && ev.name === 'request') {
				var a = ev.attrs || {};
				req.method = String(a.method || req.method || '--');
				req.path = String(a.path || req.path || '--');
			}
			if (ev.kind === 'span_end') {
				var sa = ev.attrs || {};
				req.stages.push({ name: ev.name, duration: formatMs(ev.duration_ms),
					detail: summarizeAttrs(sa, Object.keys(sa)) });
			}
			if (ev.kind === 'request') {
				req.finalized = true;
				req.method = String(ev.method || req.method || '--');
				req.path = String(ev.path || req.path || '--');
				req.status = Number(ev.status || 0);
				req.statusLabel = String(ev.status || '--');
				req.durationMs = ev.duration_ms;
				req.durationLabel = formatMs(ev.duration_ms);
				req.failed = !!ev.failed;
				if (ev.error) req.errorMessage = String(ev.error);
			}
		}

		var requests = [];
		for (var k in byTrace) {
			if (!Object.prototype.hasOwnProperty.call(byTrace, k)) continue;
			var r = byTrace[k];
			if (!r.finalized) continue;
			var parts = [];
			for (var s = 0; s < r.stages.length; s++) {
				parts.push(r.stages[s].name + ' ' + r.stages[s].duration);
			}
			r.stageSummary = parts.length > 0 ? parts.join(' \u00b7 ') : 'request complete';
			requests.push(r);
		}
		requests.sort(function (a, b) { return b.maxTs - a.maxTs; });
		if (requests.length > 50) requests = requests.slice(0, 50);

		var prevExpanded = state.expandedTraceId;
		state.requests = requests;
		state.streamLabel = requests.length + 'r';
		state.expandedTraceId = '';
		for (var j = 0; j < requests.length; j++) {
			if (requests[j].traceId === prevExpanded) {
				state.expandedTraceId = prevExpanded;
				break;
			}
		}
	}

	function appendEvent(event) {
		rawEvents.push(event);
		if (rawEvents.length > MAX_EVENTS) rawEvents = rawEvents.slice(-MAX_EVENTS);
		rebuildRequests();
	}

	function closeLiveStream() {
		if (liveSource) { liveSource.close(); liveSource = null; }
	}

	function connectLiveStream() {
		closeLiveStream();
		if (typeof EventSource !== 'function') { state.streamLabel = 'ssc n/a'; return; }
		liveSource = new EventSource('/__dev/traces/live');
		state.streamLabel = 'connecting';
		liveSource.addEventListener('ready', function () { state.streamLabel = 'live'; });
		liveSource.addEventListener('trace', function (e) {
			state.streamLabel = 'live';
			try { appendEvent(JSON.parse(e.data)); } catch (_) { state.streamLabel = 'parse err'; }
		});
		liveSource.onerror = function () { state.streamLabel = 'reconnecting'; };
	}

	function mount(root) {
		if (!(root instanceof Element) || root.hidden) return;
		if (!state) state = createState();
		closeLiveStream();
		root.removeAttribute('v-pre');
		if (app) { app.unmount(); app = null; }
		if (!(window.PetiteVue && window.PetiteVue.createApp)) {
			setTimeout(function () { mount(root); }, 200);
			return;
		}
		app = window.PetiteVue.createApp(state);
		state = window.PetiteVue.reactive(state);
		app.mount(root);
		root.setAttribute('data-widget-state', 'mounted');

		// Seed with snapshot, then connect live
		fetch('/__dev/traces').then(function (r) { return r.json(); }).then(function (data) {
			if (data && Array.isArray(data.traces)) {
				rawEvents = data.traces.slice(-MAX_EVENTS);
				rebuildRequests();
			}
		}).catch(function () {}).finally(function () { connectLiveStream(); });
	}

	function unmount(root) {
		closeLiveStream();
		if (app) { app.unmount(); app = null; }
		if (root instanceof Element) root.removeAttribute('data-widget-state');
	}

	function refresh(scope) {
		var roots = scope ? scope.querySelectorAll(ROOT_SELECTOR) : document.querySelectorAll(ROOT_SELECTOR);
		for (var i = 0; i < roots.length; i++) {
			if (!roots[i].hidden) mount(roots[i]);
		}
	}

	window.FuwaShellObservability = {
		mount: mount, unmount: unmount, refresh: refresh, selector: ROOT_SELECTOR,
		appendEvents: function (events) {
			if (!Array.isArray(events)) return;
			console.debug('[obs] appendEvents', events.length, 'events');
			for (var i = 0; i < events.length; i++) {
				try {
					appendEvent(JSON.parse(events[i]));
				} catch (e) {
					console.debug('[obs] appendEvents parse error', e);
				}
			}
			// Also POST to the server ring buffer so Wasmoon traces survive
			// page refreshes and appear in /__dev/traces snapshots.
			try {
				fetch('/__dev/traces', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ events: events.map(function (s) { return JSON.parse(s); }) })
				}).catch(function () {});
			} catch (_) {}
		}
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
