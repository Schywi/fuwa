// Data provider: summarized request traces.
// Always included (cheap — ~200 tokens for 5 traces).
// Reads from /__dev/traces dev server ring buffer.
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	var cached_traces = null;
	var cache_ts = 0;
	var CACHE_TTL_MS = 1000;

	window.FuwaAITools.traces = {
		name: 'traces',
		describe: 'Last N summarized request traces (method, path, status, timing, stages)',
		cost: '~40 tokens per trace',
		always: true,
		triggers: ['trace', 'request', 'slow', 'latency', '/trace'],

		fetch: function () {
			return fetch('/__dev/traces')
				.then(function (r) { return r.json(); })
				.then(function (data) {
					cached_traces = data.traces || [];
					cache_ts = Date.now();
					return cached_traces;
				});
		},

		collect: function () {
			return this.collectFormatted(5);
		},

		collectFormatted: function (limit) {
			limit = limit || 5;
			var traces = getFreshTraces();
			var requests = parseRequestTraces(traces, limit);
			if (requests.length === 0) {
				return { type: 'trace_summary', source: 'traces', items: [] };
			}

			var items = requests.map(function (r) {
				return {
					method: r.method,
					path: r.path,
					status: r.status,
					duration_ms: r.timing_ms,
					stages: r.stages,
				};
			});

			return { type: 'trace_summary', source: 'traces', items: items };
		}
	};

	function getFreshTraces() {
		if (cached_traces !== null && Date.now() - cache_ts < CACHE_TTL_MS) {
			return cached_traces;
		}
		return cached_traces || [];
	}

	function parseRequestTraces(traces, limit) {
		if (!traces || traces.length === 0) return [];

		var by_trace = {};
		traces.forEach(function (ev) {
			if (!ev.trace_id) return;
			var r = by_trace[ev.trace_id];
			if (!r) {
				r = { trace_id: ev.trace_id, method: '--', path: '--', status: 0, timing_ms: 0, stages: [], complete: false };
				by_trace[ev.trace_id] = r;
			}
			if (ev.kind === 'span_start' && ev.name === 'request' && ev.attrs) {
				r.method = ev.attrs.method || r.method;
				r.path = ev.attrs.path || r.path;
			}
			if (ev.kind === 'request') {
				r.method = ev.method || r.method;
				r.path = ev.path || r.path;
				r.status = ev.status || 0;
				r.timing_ms = typeof ev.duration_ms === 'number' ? Math.round(ev.duration_ms) : 0;
				r.complete = true;
			}
			if (ev.kind === 'span_end') {
				r.stages.push(ev.name + ' ' + (typeof ev.duration_ms === 'number' ? Math.round(ev.duration_ms) + 'ms' : '--'));
			}
		});

		var requests = [];
		for (var key in by_trace) {
			if (Object.prototype.hasOwnProperty.call(by_trace, key)) {
				var r = by_trace[key];
				if (r.complete) requests.push(r);
			}
		}
		requests.sort(function (a, b) { return b.trace_id.localeCompare(a.trace_id); });
		return requests.slice(0, limit);
	}

	window.FuwaAITools.register(window.FuwaAITools.traces);
})();
