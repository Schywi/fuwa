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
			// Platform health
			vector:   { up: false, latencyMs: 0, label: 'vector-router' },
			vm:       { up: false, latencyMs: 0, label: 'victoriametrics' },
			clickhouse: { up: false, latencyMs: 0, label: 'clickhouse' },

			// Live metrics
			reqPerSec:   '--',
			errorRate:   '--',
			p95Ms:       '--',

			// Recent traces (live stream)
			traces: [],
			traceCount: 0,

			// Computed helpers for templates
			healthClass: function (svc) {
				return svc.up ? 'health-up' : 'health-down';
			},
			healthIcon: function (svc) {
				return svc.up ? '\u2713' : '\u2717';
			},
		};
	}

	// ── API helpers ──────────────────────────────────────────────────────

	function fetchJSON(url) {
		return fetch(url, { signal: AbortSignal.timeout(2000) })
			.then(function (r) {
				if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
				return r.json();
			});
	}

	// ── Pollers ──────────────────────────────────────────────────────────

	function pollHealth() {
		var services = [
			{ key: 'vector',    url: '/__dev/proxy/vector/health' },
			{ key: 'vm',        url: '/__dev/proxy/vm/health' },
			{ key: 'clickhouse', url: '/__dev/proxy/clickhouse/ping' },
		];

		services.forEach(function (svc) {
			var started = performance.now();
			fetchJSON(svc.url).then(function () {
				state[svc.key].up = true;
				state[svc.key].latencyMs = Math.round(performance.now() - started);
			}).catch(function () {
				state[svc.key].up = false;
				state[svc.key].latencyMs = 0;
			});
		});
	}

	function pollMetrics() {
		// Query VictoriaMetrics for the last 5 minutes of data.
		var queries = [
			{ field: 'reqPerSec', q: 'rate(fuwa_http_requests_total[5m])' },
			{ field: 'p95Ms',     q: 'histogram_quantile(0.95, rate(fuwa_http_request_duration_ms_bucket[5m]))' },
		];

		queries.forEach(function (q) {
			var url = '/__dev/proxy/vm/api/v1/query?query=' + encodeURIComponent(q.q);
			fetchJSON(url).then(function (data) {
				var result = data && data.data && data.data.result;
				if (result && result.length > 0) {
					var val = result[0].value;
					if (val && val.length >= 2) {
						state[q.field] = parseFloat(val[1]).toFixed(1);
					}
				}
			}).catch(function () {
				state[q.field] = '--';
			});
		});

		// Error rate is derived from two counters.
		var errQuery = 'rate(fuwa_http_request_errors_total[5m])';
		var reqQuery = 'rate(fuwa_http_requests_total[5m])';
		var url = '/__dev/proxy/vm/api/v1/query?query=' + encodeURIComponent(reqQuery);

		fetchJSON(url).then(function (reqData) {
			var reqVal = 0;
			var result = reqData && reqData.data && reqData.data.result;
			if (result && result.length > 0) {
				var val = result[0].value;
				if (val && val.length >= 2) reqVal = parseFloat(val[1]);
			}

			return fetchJSON('/__dev/proxy/vm/api/v1/query?query=' + encodeURIComponent(errQuery))
				.then(function (errData) {
					var errVal = 0;
					var result = errData && errData.data && errData.data.result;
					if (result && result.length > 0) {
						var val = result[0].value;
						if (val && val.length >= 2) errVal = parseFloat(val[1]);
					}
					state.errorRate = reqVal > 0 ? (errVal / reqVal * 100).toFixed(1) + '%' : '0.0%';
				});
		}).catch(function () {
			state.errorRate = '--';
		});
	}

	function pollTraces() {
		fetchJSON('/__dev/traces').then(function (data) {
			if (data && data.traces) {
				state.traces = data.traces;
				state.traceCount = data.traces.length;
			}
		}).catch(function () {
			// dev server may not have traces yet
		});
	}

	function pollAll() {
		if (!mounted || !state) return;
		pollHealth();
		pollMetrics();
		pollTraces();
	}

	function formatTraceTime(ts) {
		if (!ts) return '--:--:--';
		var d = new Date(ts * 1000);
		return d.toTimeString().slice(0, 8);
	}

	function formatTraceLine(trace) {
		var method = trace.method || '--';
		var path = trace.path || '--';
		var status = trace.status || (trace.failed ? 500 : 200);
		var ms = trace.duration_ms != null ? Math.round(trace.duration_ms) + 'ms' : '--ms';
		return formatTraceTime(trace.timestamp) + '  ' + method + ' ' + path + '  ' + status + '  ' + ms;
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
