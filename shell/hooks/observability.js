(function () {
	'use strict';

	// Observability panel — health checks, live metrics, and recent traces
	// from the Python dev server's /__dev/ API.  Activated when the workspace
	// switches to the "obs" view.

	const LOG_PREFIX = '[shell:obs]';
	const POLL_MS = 3000;
	let timer = null;
	let state = null;
	let mounted = false;

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	// ── Petite‑vue state factory ─────────────────────────────────────────

	function createState() {
		return {
			vector:   { up: false, latencyMs: 0 },
			vm:       { up: false, latencyMs: 0 },
			clickhouse: { up: false, latencyMs: 0 },

			reqCount:  '--',
			errorRate: '--',
			p95Ms:     '--',

			traces: [],
			traceCount: 0,

			healthClass: function (svc) {
				return svc.up ? 'health-up' : 'health-down';
			},
			healthIcon: function (svc) {
				return svc.up ? '\u2713' : '\u2717';
			},
		};
	}

	// ── API helpers ──────────────────────────────────────────────────────

	function fetchOK(url, timeout) {
		timeout = timeout || 2000;
		return fetch(url, { signal: AbortSignal.timeout(timeout) })
			.then(function (r) {
				if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
				// success — body may be plain text, we don't parse it
			});
	}

	function fetchJSON(url, timeout) {
		timeout = timeout || 2000;
		return fetch(url, { signal: AbortSignal.timeout(timeout) })
			.then(function (r) {
				if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
				return r.json();
			});
	}

	// ── Pollers ──────────────────────────────────────────────────────────

	function pollHealth() {
		var services = [
			{ key: 'vector',     url: '/__dev/proxy/vector/health' },
			{ key: 'vm',         url: '/__dev/proxy/vm/health' },
			{ key: 'clickhouse', url: '/__dev/proxy/clickhouse/ping' },
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

	function pollTraces() {
		fetchJSON('/__dev/traces').then(function (data) {
			if (data && data.traces) {
				state.traces = data.traces;
				state.traceCount = data.traces.length;
				computeMetrics(data.traces);
			}
		}).catch(function () {
			// dev server may not have traces yet
		});
	}

	function computeMetrics(traces) {
		// Only look at completed request spans (kind === "request", with duration_ms).
		var requests = [];
		for (var i = 0; i < traces.length; i++) {
			var t = traces[i];
			if (t.kind === 'request' && typeof t.duration_ms === 'number' && !isNaN(t.duration_ms)) {
				requests.push(t);
			}
		}

		if (requests.length === 0) {
			state.reqCount  = '--';
			state.errorRate = '--';
			state.p95Ms     = '--';
			return;
		}

		// Request count (total in buffer).
		state.reqCount = String(requests.length);

		// Error rate: percentage of failed traces.
		var failed = 0;
		for (var j = 0; j < requests.length; j++) {
			if (requests[j].failed) failed++;
		}
		state.errorRate = (failed / requests.length * 100).toFixed(1) + '%';

		// p95 latency: sort durations, pick the 95th percentile.
		var durations = requests.map(function (r) { return r.duration_ms; }).sort(function (a, b) { return a - b; });
		var idx = Math.ceil(durations.length * 0.95) - 1;
		if (idx < 0) idx = 0;
		state.p95Ms = Math.round(durations[idx]);
	}

	function pollAll() {
		if (!mounted || !state) return;
		pollHealth();
		pollTraces();
	}

	// ── Trace formatting ─────────────────────────────────────────────────

	function formatTraceLine(trace) {
		// Trace spans have attrs.method, attrs.path, attrs.status as nested fields.
		var attrs = trace.attrs || {};
		var method = attrs.method || trace.method || '--';
		var path   = attrs.path   || trace.path   || '--';
		var status = attrs.status || trace.status || (trace.failed ? 500 : 200);
		var ms     = trace.duration_ms != null ? Math.round(trace.duration_ms) + 'ms' : '';
		return method + ' ' + path + '  ' + status + '  ' + ms;
	}

	// ── Petite‑vue scope ─────────────────────────────────────────────────

	function mount(root) {
		if (mounted) return;

		state = createState();
		state.formatTraceLine = formatTraceLine;

		if (window.PetiteVue && window.PetiteVue.createApp) {
			window.PetiteVue.createApp(state).mount(root);
		} else {
			log('petite-vue not ready, retrying');
			setTimeout(function () { mount(root); }, 200);
			return;
		}

		mounted = true;
		pollAll();
		timer = setInterval(pollAll, POLL_MS);
		log('mounted');
	}

	function unmount() {
		mounted = false;
		state = null;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		log('unmounted');
	}

	// ── Public API ───────────────────────────────────────────────────────

	window.FuwaShellObservability = {
		mount: mount,
		unmount: unmount,
	};
})();
