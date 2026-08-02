'use strict';

export const ROOT_SELECTOR = '[data-obs-root]';
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

function formatMs(value) {
	return typeof value === 'number' && !isNaN(value) ? Math.round(value) + 'ms' : '--';
}

function summarizeAttrs(attrs, keys) {
	const parts = [];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (attrs[key] != null) parts.push(key + '=' + String(attrs[key]));
	}
	return parts.join(' ');
}

function formatEventLine(event) {
	const attrs = event.attrs || {};
	let label;
	let tone;
	if (event.kind === 'span_start') {
		label = '\u25b6 ' + event.name + ' ' + summarizeAttrs(attrs, ['method', 'path', 'files', 'bytes']);
	} else if (event.kind === 'span_log') {
		const msg = String(event.message || 'event');
		const fields = event.fields || {};
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
	const byTrace = {};
	for (let i = 0; i < rawEvents.length; i++) {
		const event = rawEvents[i];
		const traceId = event.trace_id;
		if (!traceId) continue;

		let req = byTrace[traceId];
		if (!req) {
			req = {
				traceId: traceId,
				method: '--',
				path: '--',
				status: 0,
				statusLabel: '--',
				durationMs: null,
				durationLabel: '--',
				stageSummary: '',
				failed: false,
				stages: [],
				logs: [],
				finalized: false,
				maxTs: 0
			};
			byTrace[traceId] = req;
		}

		const ts = typeof event._ts === 'number' ? event._ts : 0;
		if (ts > req.maxTs) req.maxTs = ts;

		if (req.logs.length < 32) {
			const formatted = formatEventLine(event);
			req.logs.push({ kind: event.kind, label: formatted.label, ts: ts, tone: formatted.tone || null });
		}

		if (event.kind === 'span_start' && event.name === 'request') {
			const attrs = event.attrs || {};
			req.method = String(attrs.method || req.method || '--');
			req.path = String(attrs.path || req.path || '--');
		}
		if (event.kind === 'span_end') {
			const attrs = event.attrs || {};
			req.stages.push({
				name: event.name,
				duration: formatMs(event.duration_ms),
				detail: summarizeAttrs(attrs, Object.keys(attrs))
			});
		}
		if (event.kind === 'request') {
			req.finalized = true;
			req.method = String(event.method || req.method || '--');
			req.path = String(event.path || req.path || '--');
			req.status = Number(event.status || 0);
			req.statusLabel = String(event.status || '--');
			req.durationMs = event.duration_ms;
			req.durationLabel = formatMs(event.duration_ms);
			req.failed = !!event.failed;
			if (event.error) req.errorMessage = String(event.error);
		}
	}

	let requests = [];
	for (const key in byTrace) {
		if (!Object.prototype.hasOwnProperty.call(byTrace, key)) continue;
		const request = byTrace[key];
		if (!request.finalized) {
			if (request.logs.length === 0) continue;
			const firstKind = request.logs[0].kind;
			if (firstKind !== 'span_log') continue;
			request.method = 'LOG';
			request.path = request.logs[0].label.split(' ')[0] || request.traceId.replace('log_', '');
			request.statusLabel = request.logs.length + ' entries';
			request.durationLabel = '--';
			request.stageSummary = 'centralized log bus';
			request.finalized = true;
		}
		if (!request.finalized) continue;
		const parts = [];
		for (let i = 0; i < request.stages.length; i++) {
			parts.push(request.stages[i].name + ' ' + request.stages[i].duration);
		}
		request.stageSummary = parts.length > 0 ? parts.join(' \u00b7 ') : 'request complete';
		requests.push(request);
	}
	requests.sort(function (a, b) { return b.maxTs - a.maxTs; });
	if (requests.length > 50) requests = requests.slice(0, 50);

	const prevExpanded = state.expandedTraceId;
	state.requests = requests;
	state.streamLabel = requests.length + 'r';
	state.expandedTraceId = '';
	for (let i = 0; i < requests.length; i++) {
		if (requests[i].traceId === prevExpanded) {
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
	if (liveSource) {
		liveSource.close();
		liveSource = null;
	}
}

function connectLiveStream() {
	closeLiveStream();
	if (typeof EventSource !== 'function') {
		state.streamLabel = 'ssc n/a';
		return;
	}
	liveSource = new EventSource('/__dev/traces/live');
	state.streamLabel = 'connecting';
	liveSource.addEventListener('ready', function () {
		state.streamLabel = 'live';
	});
	liveSource.addEventListener('trace', function (event) {
		state.streamLabel = 'live';
		try {
			appendEvent(JSON.parse(event.data));
		} catch (_) {
			state.streamLabel = 'parse err';
		}
	});
	liveSource.onerror = function () {
		state.streamLabel = 'reconnecting';
	};
}

export function mount(root) {
	if (!(root instanceof Element) || root.hidden) return;
	if (!state) state = createState();
	closeLiveStream();
	root.removeAttribute('v-pre');
	if (app) {
		app.unmount();
		app = null;
	}
	if (!(window.PetiteVue && window.PetiteVue.createApp)) {
		setTimeout(function () { mount(root); }, 200);
		return;
	}
	app = window.PetiteVue.createApp(state);
	state = window.PetiteVue.reactive(state);
	app.mount(root);
	root.setAttribute('data-widget-state', 'mounted');

	fetch('/__dev/traces').then(function (response) {
		return response.json();
	}).then(function (data) {
		if (data && Array.isArray(data.traces)) {
			rawEvents = data.traces.slice(-MAX_EVENTS);
			rebuildRequests();
		}
	}).catch(function () {}).finally(function () {
		connectLiveStream();
	});
}

export function unmount(root) {
	closeLiveStream();
	if (app) {
		app.unmount();
		app = null;
	}
	if (root instanceof Element) root.removeAttribute('data-widget-state');
}

export function refresh(scope) {
	const roots = scope ? scope.querySelectorAll(ROOT_SELECTOR) : document.querySelectorAll(ROOT_SELECTOR);
	for (let i = 0; i < roots.length; i++) {
		if (!roots[i].hidden) mount(roots[i]);
	}
}

export function appendEvents(events) {
	if (!Array.isArray(events)) return;
	console.debug('[obs] appendEvents', events.length, 'events');
	for (let i = 0; i < events.length; i++) {
		try {
			appendEvent(JSON.parse(events[i]));
		} catch (error) {
			console.debug('[obs] appendEvents parse error', error);
		}
	}
	try {
		fetch('/__dev/traces', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ events: events.map(function (value) { return JSON.parse(value); }) })
		}).catch(function () {});
	} catch (_) {}
}

export function log(source, message, fields) {
	console.debug('[' + source + '] ' + message, fields || '');
	const traceId = 'log_' + source.replace(/[^a-zA-Z0-9_]/g, '_');
	appendEvent({
		kind: 'span_log',
		name: source,
		trace_id: traceId,
		message: message,
		fields: fields || {},
		_ts: Date.now() / 1000
	});
}

window.FuwaObservability = {
	log: log
};

window.FuwaShellObservability = {
	mount: mount,
	unmount: unmount,
	refresh: refresh,
	selector: ROOT_SELECTOR,
	appendEvents: appendEvents
};

document.addEventListener('htmx:beforeSwap', function (event) {
	const scope = event.detail && event.detail.target;
	const roots = (scope && scope.querySelectorAll) ? scope.querySelectorAll(ROOT_SELECTOR) : [];
	for (let i = 0; i < roots.length; i++) unmount(roots[i]);
});

document.addEventListener('htmx:afterSwap', function (event) {
	const scope = event.detail && event.detail.target;
	if (!(scope && scope.querySelectorAll)) return;
	const roots = scope.querySelectorAll(ROOT_SELECTOR);
	for (let i = 0; i < roots.length; i++) {
		if (!roots[i].hidden) mount(roots[i]);
	}
});

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', function () { refresh(); }, { once: true });
} else {
	refresh();
}
