// Data provider: request traces from the dev server observability ring buffer.
// Always included in the AI context (cheap — only ~200 tokens for 10 traces).
(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	var cached_traces = null;
	var cache_ts = 0;
	var CACHE_TTL_MS = 1500;

	window.FuwaAITools.traces = {
		name: 'traces',
		describe: 'Last 10 request traces (method, path, status, timing)',
		cost: '~200 tokens',
		always: true,

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
			// Use cached data if fresh
			if (cached_traces !== null && Date.now() - cache_ts < CACHE_TTL_MS) {
				return formatTraces(cached_traces);
			}

			// Synchronous fallback: return cached data even if stale,
			// we rely on the async fetch to refresh in the background.
			// The first call on mount triggers the fetch.
			if (cached_traces !== null) {
				return formatTraces(cached_traces);
			}

			// No data yet — fetch hasn't completed
			return '';
		}
	};

	function formatTraces(traces) {
		if (!traces || traces.length === 0) return '### Recent Traces\n(no requests yet)';

		// Filter to completed request events
		var requests = [];
		var by_trace = {};

		traces.forEach(function (ev) {
			if (!ev.trace_id) return;
			var req = by_trace[ev.trace_id];
			if (!req) {
				req = { trace_id: ev.trace_id, method: '--', path: '--', status: 0, timing: '--', stages: [] };
				by_trace[ev.trace_id] = req;
			}
			if (ev.kind === 'span_start' && ev.name === 'request' && ev.attrs) {
				req.method = ev.attrs.method || req.method;
				req.path = ev.attrs.path || req.path;
			}
			if (ev.kind === 'request') {
				req.method = ev.method || req.method;
				req.path = ev.path || req.path;
				req.status = ev.status || 0;
				req.timing = (typeof ev.duration_ms === 'number') ? Math.round(ev.duration_ms) + 'ms' : '--';
				req.complete = true;
			}
			if (ev.kind === 'span_end') {
				var name = ev.name;
				var dur = (typeof ev.duration_ms === 'number') ? Math.round(ev.duration_ms) + 'ms' : '--';
				req.stages.push(name + ' ' + dur);
			}
		});

		for (var key in by_trace) {
			if (Object.prototype.hasOwnProperty.call(by_trace, key)) {
				var r = by_trace[key];
				if (r.complete) requests.push(r);
			}
		}

		// Sort by trace_id descending (newest first)
		requests.sort(function (a, b) { return b.trace_id.localeCompare(a.trace_id); });
		var recent = requests.slice(0, 10);

		if (recent.length === 0) return '### Recent Traces\n(no completed requests yet)';

		var lines = ['### Recent Traces'];
		recent.forEach(function (r) {
			var stage_str = r.stages.length > 0 ? ' · ' + r.stages.join(' · ') : '';
			lines.push(r.method + ' ' + r.path + ' → ' + r.status + ' · ' + r.timing + stage_str);
		});

		return lines.join('\n');
	}

	window.FuwaAITools.register(window.FuwaAITools.traces);
})();
