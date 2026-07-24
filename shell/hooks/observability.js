(function () {
	'use strict';

	// Observability panel — health checks, live metrics, and recent traces
	// from the Python dev server's /__dev/ API.  Activated when the workspace
	// switches to the "obs" view.

	const LOG_PREFIX = '[shell:obs]';
	const ROOT_SELECTOR = '[data-obs-root]';
	const POLL_MS = 3000;
	let timer = null;
	let state = null;
	let app = null;

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
			state: root.getAttribute('data-widget-state') || null
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

		state.reqCount = String(requests.length);

		var failed = 0;
		for (var j = 0; j < requests.length; j++) {
			if (requests[j].failed) failed++;
		}
		state.errorRate = (failed / requests.length * 100).toFixed(1) + '%';

		var durations = requests.map(function (r) { return r.duration_ms; }).sort(function (a, b) { return a - b; });
		var idx = Math.ceil(durations.length * 0.95) - 1;
		if (idx < 0) idx = 0;
		state.p95Ms = Math.round(durations[idx]);
	}

	function pollAll() {
		if (!state) return;
		pollHealth();
		pollTraces();
	}

	// ── Trace formatting ─────────────────────────────────────────────────

	function formatTraceLine(trace) {
		var attrs = trace.attrs || {};
		var method = attrs.method || trace.method || '--';
		var path   = attrs.path   || trace.path   || '--';
		var status = attrs.status || trace.status || (trace.failed ? 500 : 200);
		var ms     = trace.duration_ms != null ? Math.round(trace.duration_ms) + 'ms' : '';
		return method + ' ' + path + '  ' + status + '  ' + ms;
	}

	// ── Petite‑vue scope ─────────────────────────────────────────────────

	function mount(root) {
		if (!(root instanceof Element)) {
			return;
		}

		if (!state) {
			state = createState();
			state.formatTraceLine = formatTraceLine;
		}

		if (timer) {
			clearInterval(timer);
			timer = null;
		}

		if (app) {
			app.unmount();
			app = null;
		}

		// Remove v-pre so petite-vue compiles this subtree (it was
		// v-pre'd to prevent the workspace scope from evaluating it).
		root.removeAttribute('v-pre');

		if (window.PetiteVue && window.PetiteVue.createApp) {
			app = window.PetiteVue.createApp(state);
			app.mount(root);
		} else {
			log('petite-vue not ready, retrying');
			setTimeout(function () { mount(root); }, 200);
			return;
		}

		root.setAttribute('data-widget-state', 'mounted');
		root.setAttribute('data-widget-kind', 'observability');
		pollAll();
		timer = setInterval(pollAll, POLL_MS);
		log('mount:success', describeRoot(root));
	}

	function unmount(root) {
		if (!(root instanceof Element)) {
			return;
		}

		if (timer) {
			clearInterval(timer);
			timer = null;
		}

		if (app) {
			app.unmount();
			app = null;
		}

		root.removeAttribute('data-widget-state');
		root.removeAttribute('data-widget-kind');
		log('unmount', describeRoot(root));
	}

	function refresh(scope) {
		var target = resolveScope(scope, 'refresh');
		var roots = target.querySelectorAll(ROOT_SELECTOR);
		log('refresh', { scope: describeRoot(target) });

		if (target instanceof Element && target.matches(ROOT_SELECTOR)) {
			mount(target);
		}

		for (var i = 0; i < roots.length; i++) {
			mount(roots[i]);
		}
	}

	function clearRoots(scope) {
		var target = scope && typeof scope.querySelectorAll === 'function' ? scope : document.body || document;
		var roots = target.querySelectorAll(ROOT_SELECTOR);

		if (target instanceof Element && target.matches(ROOT_SELECTOR)) {
			unmount(target);
		}

		for (var i = 0; i < roots.length; i++) {
			unmount(roots[i]);
		}
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

	// ── Public API ───────────────────────────────────────────────────────

	window.FuwaShellObservability = {
		mount: mount,
		unmount: unmount,
		refresh: refresh,
		selector: ROOT_SELECTOR
	};

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			function () {
				log('boot:DOMContentLoaded');
				refresh(document.body || document);
			},
			{ once: true }
		);
	} else {
		log('boot:ready');
		refresh(document.body || document);
	}

	document.addEventListener('htmx:beforeSwap', handleBeforeSwap);
	document.addEventListener('htmx:afterSwap', handleAfterSwap);
})();
