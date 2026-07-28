(function () {
	'use strict';

	// Darkroom motion system: curtain loader + develop-from-black preview reveal.
	// Requires GSAP (loaded via <script> in layout.fuwa).

	if (!window.gsap) { return; }

	var gsap = window.gsap;
	var LOG_PREFIX = '[shell:motion]';
	var has_run = false;
	var reduce_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	/* ── Darkroom curtain loader ───────────────────────────────────────
	   Mirrors the L'Mirand loader: top/bottom panels split apart, a scan
	   line flashes once, a counter tweens 000→100, then the panels slide
	   off-screen revealing the IDE underneath.
	*/

	function runLoader() {
		if (reduce_motion) {
			var curtain = document.querySelector('[data-loader-curtain]');
			if (curtain) { curtain.hidden = true; }
			return;
		}

		var curtain = document.querySelector('[data-loader-curtain]');
		if (!curtain) { return; }

		var top_panel = curtain.querySelector('.loader-curtain-panel--top');
		var bottom_panel = curtain.querySelector('.loader-curtain-panel--bottom');
		var scan_line = curtain.querySelector('.loader-scan-line');
		var counter = curtain.querySelector('.loader-counter');

		if (!top_panel || !bottom_panel || !scan_line || !counter) { return; }

		curtain.hidden = false;

		var tl = gsap.timeline({
			onComplete: function () {
				curtain.hidden = true;
				log('loader:complete');
			}
		});

		// Phase 1: counter tweens 000 → 100
		tl.to(counter, {
			duration: 2.0,
			textContent: 100,
			snap: { textContent: 1 },
			ease: 'power2.inOut',
			onUpdate: function () {
				var val = Math.round(gsap.getProperty(counter, 'textContent'));
				counter.textContent = String(val).padStart(3, '0');
			}
		}, 0);

		// Phase 2: scan line flashes once (staggered into counter)
		tl.fromTo(scan_line,
			{ scaleX: 0, opacity: 0 },
			{ scaleX: 1, opacity: 1, duration: 0.3, ease: 'power2.out' },
			0.8
		);
		tl.to(scan_line,
			{ opacity: 0, duration: 0.5, ease: 'power2.in' },
			1.1
		);

		// Phase 3: panels split apart
		tl.to(top_panel, {
			yPercent: -100,
			duration: 1.1,
			ease: 'expo.inOut'
		}, 2.0);

		tl.to(bottom_panel, {
			yPercent: 100,
			duration: 1.1,
			ease: 'expo.inOut'
		}, 2.0);

		log('loader:started');
	}

	/* ── Develop-from-black preview reveal ────────────────────────────
	   When the user clicks DEVELOP (or a file is saved and the preview
	   updates), the preview stage gets a black overlay that animates away,
	   simulating photographic paper developing in the darkroom.
	*/

	function developPreview(stage) {
		if (reduce_motion) { return; }
		if (!(stage instanceof Element)) {
			stage = document.querySelector('[data-preview-stage]');
		}
		if (!stage) { return; }

		// Remove any existing overlay
		var existing = stage.querySelector('.develop-overlay');
		if (existing) { existing.remove(); }

		var overlay = document.createElement('div');
		overlay.className = 'develop-overlay';
		stage.style.position = 'relative';
		stage.appendChild(overlay);

		gsap.to(overlay, {
			opacity: 0,
			duration: 0.8,
			ease: 'power3.inOut',
			onComplete: function () {
				overlay.remove();
				stage.style.position = '';
			}
		});

		log('develop:started');
	}

	/* ── Typewriter header tips ──────────────────────────────────────── */

	var typewriterTips = [
		{ text: '⌘K opens the file launcher — type to filter, ↵ to open', kao: '(˶˃⤙˂˶)' },
		{ text: 'Switch payloads to see different apps in the phone preview', kao: '( •ω•)ﾉ' },
		{ text: 'Edits compile automatically — watch the terminal for output', kao: '(=`ω´=)' },
		{ text: 'Click Grafana ↗ to inspect runtime traces and metrics', kao: '(˘ω˘)' },
		{ text: 'The phone preview runs a live Wasmoon runtime in your browser', kao: '( ˘▽˘)っ' }
	];

	var typewriterTimer = null;
	var typewriterTipIndex = 0;
	var typewriterCharIndex = 0;
	var typewriterPhase = 'typing'; // typing | holding | deleting
	var typewriterEl = null;

	function typewriterTick() {
		var el = typewriterEl || document.querySelector('.owner-sub');
		if (!el) return;
		typewriterEl = el;
		el.classList.add('typewriter-active');

		var tip = typewriterTips[typewriterTipIndex];
		var fullText = tip.text + '  ' + tip.kao;

		if (typewriterPhase === 'typing') {
			typewriterCharIndex++;
			el.textContent = fullText.substring(0, typewriterCharIndex);
			if (typewriterCharIndex >= fullText.length) {
				typewriterPhase = 'holding';
				typewriterTimer = setTimeout(typewriterTick, 4000);
				return;
			}
			typewriterTimer = setTimeout(typewriterTick, 28);
		} else if (typewriterPhase === 'holding') {
			typewriterPhase = 'deleting';
			typewriterTimer = setTimeout(typewriterTick, 18);
		} else if (typewriterPhase === 'deleting') {
			typewriterCharIndex--;
			el.textContent = fullText.substring(0, typewriterCharIndex);
			if (typewriterCharIndex <= 0) {
				typewriterPhase = 'typing';
				typewriterTipIndex = (typewriterTipIndex + 1) % typewriterTips.length;
				typewriterTimer = setTimeout(typewriterTick, 400);
				return;
			}
			typewriterTimer = setTimeout(typewriterTick, 16);
		}
	}

	function startTypewriter() {
		if (typewriterTimer) clearTimeout(typewriterTimer);
		var el = document.querySelector('.owner-sub');
		if (!el) return;
		typewriterEl = el;
		typewriterTipIndex = 0;
		typewriterCharIndex = 0;
		typewriterPhase = 'typing';
		typewriterTick();
	}

	/* ── Architecture panel (mermaid) ────────────────────────────────── */

	var mermaidLoaded = false;
	var mermaidInitialized = false;
	var mermaidLoadPromise = null;
	var archZoom = 1;
	var archDrag = {
		active: false,
		startX: 0,
		startY: 0,
		scrollLeft: 0,
		scrollTop: 0,
		container: null
	};

	function joinDiagram(lines) {
		return lines.join('\n');
	}

	function activeArchTabName() {
		var active = document.querySelector('.arch-tab--active');
		return active ? active.getAttribute('data-arch-tab') || 'frontend' : 'frontend';
	}

	function escapeHtml(value) {
		return String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;');
	}

	function showArchFallback(definition, errorText) {
		var el = document.querySelector('[data-arch-diagram]');
		if (!el) return;
		setArchMessage(
			el,
			definition,
			errorText ? 'error' : 'info',
			errorText || 'Loading Mermaid…'
		);
	}

	function archDiagramRoot() {
		return document.querySelector('[data-arch-diagram]');
	}

	function ensureArchInner(container) {
		if (!(container instanceof Element)) {
			return null;
		}

		var inner = container.querySelector('.arch-diagram-inner');
		if (!inner) {
			container.innerHTML = '';
			inner = document.createElement('div');
			inner.className = 'arch-diagram-inner';
			container.appendChild(inner);
		}
		return inner;
	}

	function setArchMessage(container, definition, tone, message) {
		var inner = ensureArchInner(container);
		if (!inner) return;
		var color = tone === 'error' ? '#fb7185' : '#c0caf5';
		inner.innerHTML =
			'<div style="color:' + color + ';font-size:0.78rem;margin-bottom:12px">' + escapeHtml(message) + '</div>' +
			'<pre style="margin:0;color:#c0caf5;font-size:0.72rem;line-height:1.45;white-space:pre;min-width:max-content">' +
			escapeHtml(definition || '') +
			'</pre>';
		container.classList.remove('is-draggable', 'is-dragging');
	}

	function mermaidScript() {
		return document.getElementById('fuwa-arch-mermaid');
	}

	function ensureMermaidRuntime() {
		if (window.mermaid) {
			if (!mermaidInitialized) {
				window.mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'loose',
					theme: 'dark',
					htmlLabels: false,
					themeCSS: '.label foreignObject { overflow: visible; }',
					look: 'classic',
					architecture: {
						nodeSeparation: 120,
						idealEdgeLengthMultiplier: 1.8
					},
					block: {
						padding: 12
					},
					flowchart: { useMaxWidth: false },
					themeVariables: { primaryColor: '#b48cff', primaryTextColor: '#c0caf5', lineColor: '#414868', fontSize: '11px' }
				});
				mermaidInitialized = true;
			}
			mermaidLoaded = true;
			return Promise.resolve(window.mermaid);
		}

		if (mermaidLoadPromise) {
			return mermaidLoadPromise;
		}

		mermaidLoadPromise = new Promise(function (resolve, reject) {
			var script = mermaidScript();
			var timeout = null;

			function cleanup() {
				if (timeout) {
					clearTimeout(timeout);
				}
				script?.removeEventListener('load', onLoad);
				script?.removeEventListener('error', onError);
			}

			function finishResolve() {
				cleanup();
				ensureMermaidRuntime().then(resolve, reject);
			}

			function finishReject(error) {
				cleanup();
				mermaidLoadPromise = null;
				reject(error);
			}

			function onLoad() {
				if (window.mermaid) {
					finishResolve();
					return;
				}
				finishReject(new Error('Mermaid script loaded without runtime'));
			}

			function onError() {
				finishReject(new Error('script load failed'));
			}

			if (!script) {
				script = document.createElement('script');
				script.id = 'fuwa-arch-mermaid';
				script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
				document.head.appendChild(script);
			}

			script.addEventListener('load', onLoad);
			script.addEventListener('error', onError);
			timeout = setTimeout(function () {
				if (window.mermaid) {
					finishResolve();
					return;
				}
				finishReject(new Error('Mermaid load timed out'));
			}, 12000);

			if (window.mermaid) {
				finishResolve();
			}
		}).finally(function () {
			mermaidLoadPromise = null;
		});

		return mermaidLoadPromise;
	}

	function currentArchSvg() {
		return document.querySelector('.arch-diagram-inner svg');
	}

	function applyArchZoom() {
		var container = archDiagramRoot();
		var svg = currentArchSvg();
		if (!(container instanceof Element) || !(svg instanceof SVGElement)) {
			return;
		}

		var viewBox = svg.getAttribute('viewBox');
		var baseWidth = Number(svg.dataset.baseWidth || 0);
		if (!(baseWidth > 0)) {
			if (viewBox) {
				var parts = viewBox.split(/\s+/);
				baseWidth = Number(parts[2] || 0);
			}
			if (!(baseWidth > 0)) {
				baseWidth = Math.max(svg.getBoundingClientRect().width, container.clientWidth || 0, 1);
			}
			svg.dataset.baseWidth = String(baseWidth);
		}

		var targetWidth = Math.max(container.clientWidth || 0, Math.round(baseWidth * archZoom));
		svg.style.width = targetWidth + 'px';
		svg.style.height = 'auto';

		if (container.scrollWidth > container.clientWidth + 4 || container.scrollHeight > container.clientHeight + 4) {
			container.classList.add('is-draggable');
		} else {
			container.classList.remove('is-draggable', 'is-dragging');
		}
	}

	function resetArchViewport() {
		var container = archDiagramRoot();
		if (!(container instanceof Element)) {
			return;
		}
		archZoom = 1;
		container.scrollLeft = 0;
		container.scrollTop = 0;
		container.classList.remove('is-dragging');
		applyArchZoom();
	}

	var mermaidDefinitions = {
		frontend: joinDiagram([
			'block',
			'  columns 4',
			'  layout["shell/views/layout.fuwa\\nvendor and hook loader"]',
			'  home["shell/views/fragments/home.fuwa\\npreview terminal obs tmux arch"]',
			'  workspace["shell/views/fragments/workspace.fuwa\\nstable data-workspace chrome"]',
			'  chrome["vendor/htmx/htmx-1.9.12.min.js + vendor/petite-vue/petite-vue-0.4.1.iife.js\\nshell swap and reactive chrome"]',
			'  editor["shell/hooks/editor.js\\nCodeMirror pendingEdits"]',
			'  preview["shell/hooks/preview.js\\npreview orchestrator"]',
			'  driver["shell/hooks/preview-browser.js\\niframe relay ordered queue"]',
			'  session["shell/hooks/runtime-session.js\\nworker lifecycle files map"]',
			'  terminal["shell/hooks/terminal.js\\nxterm write detach"]',
			'  obs["shell/hooks/observability.js\\nring buffer SSE appendEvents"]',
			'  shellfx["shell/hooks/workspace.js + shell/hooks/motion.js\\npanel toggles loader architecture UI"]',
			'  tmux["shell/hooks/tmux.js\\nEventSource /__dev/containers/live"]',
			'  cursor["shell/hooks/cursor.js\\nloupe cursor"]',
			'  tenant_html["runtime/browser/init.lua\\nbuild_runtime_srcdoc /runtime/tenant.html"]',
			'  tenant_runtime["shell/hooks/tenant-runtime.js\\nXHR bridge swap reply stream"]',
			'  tenant_libs["vendor/htmx/htmx-1.9.12.min.js + vendor/petite-vue/petite-vue-0.4.1.iife.js\\ntenant htmx and reactivity"]',
			'  worker_hook["shell/hooks/runtime-worker.js\\nWasmoon queue compile in VM"]',
			'  worker_libs["vendor/wasmoon/wasmoon-1.16.0.js + vendor/sqlite-wasm/index.mjs\\nLua engine and sqlite wasm"]',
			'  compiler["runtime/stdlib/compiler/package_web.lua\\nshared compiler boundary"]',
			'  trace["runtime/trace.lua\\ntrace_mod.set_sink __fuwa_trace_sink"]',
			'  editor -- "fuwa:editor-change" --> preview',
			'  preview --> driver',
			'  driver --> session',
			'  session --> terminal',
			'  session --> obs',
			'  driver -- "postMessage" --> tenant_runtime',
			'  tenant_runtime -- "request reply stream" --> driver',
			'  tenant_html --> tenant_runtime',
			'  tenant_libs --> tenant_runtime',
			'  session -- "boot run files" --> worker_hook',
			'  worker_hook --> worker_libs',
			'  worker_hook --> compiler',
			'  worker_hook --> trace',
			'  tmux -- "container logs SSE" --> terminal',
			'  %% shell/hooks/preview-server.js and shell/hooks/tenant-bridge.js remain legacy route-backed preview helpers and are not loaded by shell/views/layout.fuwa.'
		]),
		backend: joinDiagram([
			'block',
			'  columns 4',
			'  app["shell/app.fuwa\\nGET slash GET inspect POST switch"]',
			'  pages["shell/pages/home.fuwa\\nDashboard.build ShellViews.render_fragment"]',
			'  views["shell/view.fuwa + shell/views/home.fuwa\\nlayout and home view entry"]',
			'  fragments["shell/views/fragments/home.fuwa + shell/views/fragments/workspace.fuwa + shell/views/fragments/workspace-oob.fuwa\\nshell fragments and OOB targets"]',
			'  devserver["runtime/dev-server.py\\nraw sockets __dev routes stdin stdout bridge"]',
			'  tracebuf["runtime/dev-server.py\\ntrace buffer SSE subscribers file watcher"]',
			'  clog["runtime/container_logs.py\\ndocker logs reader threads queue"]',
			'  fuwadev["runtime/fuwa-dev.lua\\nHTTP parse static assets payload dispatch"]',
			'  bundle["runtime/browser/init.lua\\nbuild_runtime_srcdoc bundle.build bundle.to_json"]',
			'  packageweb["runtime/stdlib/compiler/package_web.lua\\nbuild wrapper main.lua"]',
			'  core["runtime/stdlib/compiler/init.lua + runtime/stdlib/compiler/modules.lua\\ncompile_runtime_files module view entry compiler"]',
			'  passes["runtime/stdlib/compiler/actions.lua + runtime/stdlib/compiler/routes.lua + runtime/stdlib/compiler/view.lua + runtime/stdlib/compiler/imports.lua + runtime/stdlib/compiler/schema.lua + runtime/stdlib/compiler/responses.lua + runtime/stdlib/compiler/diagnostics.lua + runtime/stdlib/compiler/bootstrap.lua\\nroute action view import schema response diagnostic bootstrap passes"]',
			'  stdlib["runtime/stdlib/web.lua + runtime/stdlib/view.lua + runtime/stdlib/db.lua + runtime/stdlib/schema.lua + runtime/stdlib/result.lua\\ndispatch render db schema result"]',
			'  tracing["runtime/trace.lua + runtime/log.lua\\ntrace sink scopes pretty sink serialize"]',
			'  host["runtime/host/capabilities.lua + runtime/host/dashboard.lua + runtime/host/shell_views.lua + runtime/host/bootstrap.lua\\nhost imports payload access fragment rendering"]',
			'  app --> pages',
			'  views --> fragments',
			'  pages -- "host imports" --> host',
			'  devserver --> fuwadev',
			'  devserver --> tracebuf',
			'  devserver --> clog',
			'  fuwadev --> bundle',
			'  fuwadev --> packageweb',
			'  packageweb --> core',
			'  core --> passes',
			'  packageweb --> stdlib',
			'  packageweb --> tracing',
			'  host --> fragments',
			'  bundle --> packageweb',
			'  %% package_web.lua is the boundary wrapper: compiler/init.lua emits Lua artifacts only, while fuwa-dev.lua owns HTTP file IO and live dev policy.'
		]),
		infra: joinDiagram([
			'%%{init: {"architecture": {"nodeSeparation": 120, "idealEdgeLengthMultiplier": 2.2}}}%%',
			'architecture-beta',
			'  group edge(cloud)[Edge and app]',
			'  group telemetry(cloud)[Telemetry]',
			'  group signoz(cloud)[SigNoz stack]',
			'  service compose(server)[infra/docker-compose/dev.yml] in edge',
			'  service openresty(server)[infra/openresty/dev/nginx.conf] in edge',
			'  service fuwa(server)[infra/docker-compose/app.dev.yml fuwa] in edge',
			'  service vector(server)[infra/docker-compose/vector.toml vector-router] in telemetry',
			'  service bridge(server)[infra/docker-compose/otlp-bridge.py] in telemetry',
			'  service metrics(database)[infra/docker-compose/telemetry.yml victoriametrics] in telemetry',
			'  service ui(server)[infra/docker-compose/signoz.yml signoz] in signoz',
			'  service ingester(server)[infra/docker-compose/signoz/ingester.yaml] in signoz',
			'  service clickhouse(database)[infra/docker-compose/signoz.yml signoz-clickhouse] in signoz',
			'  service keeper(disk)[infra/docker-compose/signoz/keeper-0.yaml] in signoz',
			'  service seeds(server)[infra/docker-compose/signoz-bootstrap.py] in signoz',
			'  compose:R --> L:openresty',
			'  compose:B --> T:fuwa',
			'  fuwa:R --> L:vector',
			'  vector:R --> L:bridge',
			'  vector:B --> T:metrics',
			'  bridge:R --> L:ingester',
			'  ingester:R --> L:clickhouse',
			'  keeper:B --> T:clickhouse',
			'  seeds:B --> T:ui',
			'  openresty:R --> L:ui',
			'  %% shell/views/fragments/home.fuwa tmux panel follows this dev stack: fuwa signoz signoz-ingester otlp-bridge signoz-clickhouse signoz-keeper vector-router victoriametrics.',
			'  %% fuwa-infra-exploration/infra/docker-compose/observability.yml is the alternate Uptrace-oriented stack, not the default shell topology.'
		])
	};

	function loadMermaid() {
		var tab = activeArchTabName();
		var definition = mermaidDefinitions[tab] || '';
		showArchFallback(definition, '');
		return ensureMermaidRuntime()
			.then(function () {
				return renderArchDiagram(tab);
			})
			.catch(function (error) {
				showArchFallback(definition, error && error.message ? error.message : 'script load failed');
				return false;
			});
	}

	function renderArchDiagram(tab) {
		var el = document.querySelector('[data-arch-diagram]');
		if (!el) return;
		var def = mermaidDefinitions[tab] || '';

		var inner = ensureArchInner(el);
		if (!inner) return;
		inner.innerHTML = '';

		if (!window.mermaid) {
			setArchMessage(el, def, 'info', 'Mermaid runtime unavailable');
			return Promise.resolve(false);
		}

		var parsePromise = typeof window.mermaid.parse === 'function'
			? Promise.resolve(window.mermaid.parse(def))
			: Promise.resolve();

		return parsePromise.then(function () {
			return window.mermaid.render('arch-diagram-svg-' + tab + '-' + Date.now(), def);
		}).then(function (result) {
			inner.innerHTML = result.svg;
			resetArchViewport();
			return true;
		}).catch(function (error) {
			setArchMessage(el, def, 'error', error && error.message ? error.message : 'parse error');
			return false;
		});
	}

	document.addEventListener('click', function (e) {
		var tab = e.target.closest('[data-arch-tab]');
		if (tab) {
			var name = tab.getAttribute('data-arch-tab');
			if (!name) return;
			document.querySelectorAll('.arch-tab').forEach(function (t) { t.classList.remove('arch-tab--active'); });
			tab.classList.add('arch-tab--active');
			void loadMermaid();
			return;
		}

		var zoom = e.target.closest('[data-arch-zoom]');
		if (zoom) {
			var action = zoom.getAttribute('data-arch-zoom');
			if (action === 'in') archZoom = Math.min(3, archZoom + 0.2);
			else if (action === 'out') archZoom = Math.max(0.3, archZoom - 0.2);
			else resetArchViewport();
			if (action !== 'reset') {
				applyArchZoom();
			}
		}
	});

	document.addEventListener('pointerdown', function (e) {
		var container = e.target.closest('[data-arch-diagram]');
		if (!(container instanceof Element) || !container.classList.contains('is-draggable')) {
			return;
		}
		if (e.target.closest('[data-arch-zoom], [data-arch-tab], .grafana-back-btn')) {
			return;
		}
		archDrag.active = true;
		archDrag.startX = e.clientX;
		archDrag.startY = e.clientY;
		archDrag.scrollLeft = container.scrollLeft;
		archDrag.scrollTop = container.scrollTop;
		archDrag.container = container;
		container.classList.add('is-dragging');
	});

	document.addEventListener('pointermove', function (e) {
		if (!archDrag.active || !(archDrag.container instanceof Element)) {
			return;
		}
		e.preventDefault();
		archDrag.container.scrollLeft = archDrag.scrollLeft - (e.clientX - archDrag.startX);
		archDrag.container.scrollTop = archDrag.scrollTop - (e.clientY - archDrag.startY);
	});

	document.addEventListener('pointerup', function () {
		if (archDrag.container instanceof Element) {
			archDrag.container.classList.remove('is-dragging');
		}
		archDrag.active = false;
		archDrag.container = null;
	});

	document.addEventListener('pointercancel', function () {
		if (archDrag.container instanceof Element) {
			archDrag.container.classList.remove('is-dragging');
		}
		archDrag.active = false;
		archDrag.container = null;
	});

	/* ── Boot ───────────────────────────────────────────────────────── */

	function boot() {
		if (has_run) { return; }
		has_run = true;

		if (document.readyState !== 'loading') {
			runLoader();
			startTypewriter();
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { boot(); }, { once: true });
	} else {
		boot();
	}

	// Develop preview on shell-content swaps (payload switches)
	document.addEventListener('htmx:afterSwap', function (event) {
		var target = event.detail?.target || event.detail?.elt;
		if (target instanceof Element && target.id === 'shell-content') {
			var stage = document.querySelector('[data-preview-stage]');
			if (stage) {
				setTimeout(function () { developPreview(stage); }, 100);
			}
		}
	});

	window.FuwaShellMotion = {
		developPreview: developPreview,
		loadMermaid: loadMermaid,
		runLoader: runLoader,
		startTypewriter: startTypewriter
	};
})();
