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
		var message = errorText
			? '<div style="color:#fca5a5;font-size:0.78rem;margin-bottom:12px">Mermaid render failed: ' + escapeHtml(errorText) + '</div>'
			: '<div style="color:#a1a1aa;font-size:0.78rem;margin-bottom:12px">Loading Mermaid…</div>';
		el.innerHTML = message + '<pre style="margin:0;color:#c0caf5;font-size:0.72rem;line-height:1.45;white-space:pre;min-width:max-content">' + escapeHtml(definition || '') + '</pre>';
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
					flowchart: { htmlLabels: false, useMaxWidth: false },
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
			'flowchart TD',
			'  subgraph Browser["Browser - IDE Shell"]',
			'    direction TD',
			'    BLayout["shell/views/layout.fuwa :: vendor and hook loader"]',
			'    BHome["shell/views/fragments/home.fuwa :: preview terminal obs tmux arch"]',
			'    BWorkspace["shell/views/fragments/workspace.fuwa :: stable data-workspace chrome"]',
			'    BHTMX["vendor/htmx/htmx-1.9.12.min.js :: swap lifecycle"]',
			'    BPetite["vendor/petite-vue/petite-vue-0.4.1.iife.js :: shell reactivity"]',
			'    BGSAP["vendor/gsap/gsap-3.15.0.min.js :: loader and panel transitions"]',
			'    BEditor["shell/hooks/editor.js :: CodeMirror 6 and pendingEdits"]',
			'    BWorkspaceHook["shell/hooks/workspace.js :: popover state and panel toggles"]',
			'    BPreview["shell/hooks/preview.js :: preview orchestrator"]',
			'    BDriver["shell/hooks/preview-browser.js :: iframe relay and ordered tenant queue"]',
			'    BSession["shell/hooks/runtime-session.js :: files map debounce worker lifecycle"]',
			'    BTerminal["shell/hooks/terminal.js :: xterm detach reparent write"]',
			'    BObs["shell/hooks/observability.js :: ring buffer SSE appendEvents"]',
			'    BMotion["shell/hooks/motion.js :: Mermaid tab renderer and darkroom motion"]',
			'    BTmux["shell/hooks/tmux.js :: EventSource mux for container logs"]',
			'    BCursor["shell/hooks/cursor.js :: loupe cursor"]',
			'    BLayout --> BHome',
			'    BLayout --> BHTMX',
			'    BLayout --> BPetite',
			'    BLayout --> BGSAP',
			'    BLayout --> BEditor',
			'    BLayout --> BWorkspaceHook',
			'    BLayout --> BPreview',
			'    BLayout --> BTerminal',
			'    BLayout --> BObs',
			'    BLayout --> BMotion',
			'    BLayout --> BCursor',
			'    BLayout --> BTmux',
			'    BHome --> BWorkspace',
			'    BPetite --> BWorkspaceHook',
			'    BHTMX -->|beforeSwap / afterSwap| BWorkspaceHook',
			'    BHTMX -->|beforeSwap / afterSwap| BEditor',
			'    BHTMX -->|beforeSwap / afterSwap| BTerminal',
			'    BHTMX -->|beforeSwap / afterSwap| BObs',
			'    BWorkspace -->|v-scope root| BWorkspaceHook',
			'    BWorkspaceHook -->|client-side file pick| BEditor',
			'    BEditor -->|fuwa:editor-change| BPreview',
			'    BPreview -->|create driver| BDriver',
			'    BPreview -->|writeTerminal| BTerminal',
			'    BDriver -->|create session| BSession',
			'    BSession -->|stdout / stderr| BTerminal',
			'    BSession -->|appendEvents and POST __dev_traces| BObs',
			'  end',
			'  subgraph Tenant["Tenant iframe"]',
			'    direction TD',
			'    TTenantHtml["runtime/browser/init.lua :: build_runtime_srcdoc serves /runtime/tenant.html"]',
			'    TTenant["shell/hooks/tenant-runtime.js :: TenantXMLHttpRequest swap reply stream"]',
			'    TDOM["runtime/browser/init.lua :: srcdoc app root and phone shell scaffold"]',
			'    TPetite["vendor/petite-vue/petite-vue-0.4.1.iife.js :: tenant reactivity"]',
			'    THTMX["vendor/htmx/htmx-1.9.12.min.js :: tenant XHR client"]',
			'    TTenantHtml --> TDOM',
			'    TTenantHtml --> TTenant',
			'    TPetite --> TDOM',
			'    THTMX --> TDOM',
			'    TTenant -->|swap HTML + revive scripts| TDOM',
			'  end',
			'  subgraph Worker["Web Worker (Wasmoon)"]',
			'    direction TD',
			'    WWorker["shell/hooks/runtime-worker.js :: boot run queue in-VM package_web.build"]',
			'    WWasmoon["vendor/wasmoon/wasmoon-1.16.0.js :: Lua 5.4 engine"]',
			'    WSqlite["vendor/sqlite-wasm/index.mjs and vendor/sqlite-wasm/sqlite3.wasm"]',
			'    WPackage["runtime/stdlib/compiler/package_web.lua :: same compiler entry in worker and server"]',
			'    WTrace["runtime/trace.lua :: trace_mod.set_sink to __fuwa_trace_sink"]',
			'    WWorker --> WWasmoon',
			'    WWorker --> WSqlite',
			'    WWorker -->|require through VFS| WPackage',
			'    WWorker -->|install trace sink| WTrace',
			'  end',
			'  BDriver -->|mount iframe /runtime/tenant.html| TTenantHtml',
			'  BDriver -->|postMessage ping/command/reply| TTenant',
			'  TTenant -->|postMessage ready/request/stream| BDriver',
			'  TDOM -->|user action -> XMLHttpRequest| TTenant',
			'  BSession -->|boot/run + files/sources| WWorker',
			'  WWorker -->|html/stdout/stderr/trace/done| BSession',
			'  BTmux -->|EventSource /__dev/containers/live| PyLogs["runtime/container_logs.py :: SSE mux endpoint"]',
			'  %% shell/hooks/preview-server.js and shell/hooks/tenant-bridge.js remain legacy route-backed preview helpers and are not loaded by shell/views/layout.fuwa.'
		]),
		backend: joinDiagram([
			'flowchart TD',
			'  subgraph Template["Template layer (.fuwa)"]',
			'    direction TD',
			'    TApp["shell/app.fuwa :: GET slash GET inspect POST switch"]',
			'    TPage["shell/pages/home.fuwa :: Dashboard.build and ShellViews.render_fragment"]',
			'    TRootView["shell/view.fuwa :: include views/layout.fuwa"]',
			'    THomeView["shell/views/home.fuwa :: include fragments/home.fuwa"]',
			'    TLayout["shell/views/layout.fuwa :: shell HTML CSS vendor imports"]',
			'    TFragHome["shell/views/fragments/home.fuwa :: preview terminal obs tmux arch"]',
			'    TFragWs["shell/views/fragments/workspace.fuwa :: command palette and editor form"]',
			'    TFragOob["shell/views/fragments/workspace-oob.fuwa :: OOB file and status targets"]',
			'    TApp --> TPage',
			'    TRootView --> TLayout',
			'    THomeView --> TFragHome',
			'    TPage -->|inspect action renders| TFragWs',
			'    TPage -->|inspect action renders| TFragOob',
			'  end',
			'  subgraph Python["Python dev server"]',
			'    direction TD',
			'    PServer["runtime/dev-server.py :: raw sockets __dev routes stdin stdout bridge"]',
			'    PTrace["runtime/dev-server.py :: trace buffer and SSE subscribers"]',
			'    PWatch["runtime/dev-server.py :: file_watcher to .fuwa-dev/reload-token"]',
			'    PLogs["runtime/container_logs.py :: docker logs reader threads and queue"]',
			'    PServer --> PTrace',
			'    PServer --> PWatch',
			'    PServer -->|/__dev/containers/live| PLogs',
			'  end',
			'  subgraph Lua["Lua CGI handler"]',
			'    direction TD',
			'    LServer["runtime/fuwa-dev.lua :: HTTP parse static assets payload dispatch"]',
			'    LBundle["runtime/fuwa-dev.lua :: build_bundle_response and /runtime/tenant.html"]',
			'  end',
			'  subgraph Compiler["Compiler"]',
			'    direction TD',
			'    CPackage["runtime/stdlib/compiler/package_web.lua :: build wrapper and main.lua"]',
			'    CInit["runtime/stdlib/compiler/init.lua :: compile_runtime_files"]',
			'    CModules["runtime/stdlib/compiler/modules.lua :: module and view entry compiler"]',
			'    CActions["runtime/stdlib/compiler/actions.lua :: render redirect fail sugar"]',
			'    CRoutes["runtime/stdlib/compiler/routes.lua :: routes to web.app"]',
			'    CView["runtime/stdlib/compiler/view.lua :: include expansion and M.render"]',
			'    CImports["runtime/stdlib/compiler/imports.lua :: import parsing"]',
			'    CSchema["runtime/stdlib/compiler/schema.lua :: schema to model compiler"]',
			'    CResponses["runtime/stdlib/compiler/responses.lua :: response expression parsing"]',
			'    CDiagnostics["runtime/stdlib/compiler/diagnostics.lua :: error aggregation"]',
			'    CBootstrap["runtime/stdlib/compiler/bootstrap.lua :: handle_request main.lua scaffold"]',
			'    CPackage --> CInit',
			'    CInit --> CModules',
			'    CModules --> CActions',
			'    CModules --> CRoutes',
			'    CModules --> CView',
			'    CModules --> CImports',
			'    CModules --> CSchema',
			'    CModules --> CResponses',
			'    CModules --> CDiagnostics',
			'    CPackage --> CBootstrap',
			'  end',
			'  subgraph Runtime["Runtime + host"]',
			'    direction TD',
			'    RWeb["runtime/stdlib/web.lua :: app.dispatch and render_response"]',
			'    RView["runtime/stdlib/view.lua :: HTML AST renderer f-if f-for bindings"]',
			'    RDb["runtime/stdlib/db.lua :: DB facade and provider bridge"]',
			'    RSchema["runtime/stdlib/schema.lua :: model CRUD and validate"]',
			'    RResult["runtime/stdlib/result.lua :: Ok Err helpers"]',
			'    RTrace["runtime/trace.lua :: trace.span sink scopes"]',
			'    RLog["runtime/log.lua :: pretty_sink and serialize"]',
			'    HCapabilities["runtime/host/capabilities.lua :: describe list read write compile payload"]',
			'    HDashboard["runtime/host/dashboard.lua :: workspace data bundle and runtime URLs"]',
			'    HShellViews["runtime/host/shell_views.lua :: render_fragment include expansion"]',
			'    HBootstrap["runtime/host/bootstrap.lua :: legacy host bootstrap srcdoc"]',
			'    HBrowser["runtime/browser/init.lua :: bundle.build and build_runtime_srcdoc"]',
			'    RDb --> RSchema',
			'  end',
			'  PServer -->|forward non-/__dev HTTP via stdin| LServer',
			'  LServer -->|stdout HTML/JSON/assets| PServer',
			'  LServer -->|stderr __VECTOR__ JSON| PTrace',
			'  LServer -->|/runtime/:payload_id/bundle.json| LBundle',
			'  LBundle --> HBrowser',
			'  LServer -->|package_web.build(source_files)| CPackage',
			'  TApp -->|routes compile| CRoutes',
			'  TPage -->|action compile| CActions',
			'  TRootView -->|view.fuwa compile| CView',
			'  THomeView -->|include expansion| CView',
			'  TFragHome -->|fragment compile| CView',
			'  TFragWs -->|fragment compile| CView',
			'  TFragOob -->|fragment compile| CView',
			'  CBootstrap -->|emits main.lua dispatch| RWeb',
			'  RWeb -->|render response| RView',
			'  TPage -->|use host imports| HDashboard',
			'  TPage -->|use host imports| HShellViews',
			'  HCapabilities --> HDashboard',
			'  HShellViews -->|read shell/views/* at runtime| TFragWs',
			'  HShellViews -->|read shell/views/* at runtime| TFragOob',
			'  HBrowser -->|bundle.build(include_sources)| CPackage',
			'  LServer -->|trace.set_sink(dev_trace_sink)| RTrace',
			'  LServer -->|log.pretty_sink()| RLog',
			'  %% package_web.lua is the boundary wrapper: compiler/init.lua emits Lua artifacts only, while fuwa-dev.lua owns HTTP, file IO, and live dev policy.'
		]),
		infra: joinDiagram([
			'flowchart TD',
			'  subgraph Edge["Compose entry + edge proxy"]',
			'    direction TD',
			'    IDev["fuwa-infra-exploration/infra/docker-compose/dev.yml :: includes app.dev openresty signoz telemetry"]',
			'    IOpenResty["fuwa-infra-exploration/infra/openresty/dev/nginx.conf :: slash to fuwa and dash proxies"]',
			'    IFuwa["fuwa-infra-exploration/infra/docker-compose/app.dev.yml :: fuwa service runs dev.sh"]',
			'    IDev --> IOpenResty',
			'    IDev --> IFuwa',
			'  end',
			'  subgraph Telemetry["Telemetry + dashboards"]',
			'    direction TD',
			'    IVectorCfg["fuwa-infra-exploration/infra/docker-compose/vector.toml :: http_server 8687 metrics otlp_bridge sink"]',
			'    IBridge["fuwa-infra-exploration/infra/docker-compose/otlp-bridge.py :: TCP 4321 JSON to OTLP HTTP traces"]',
			'    IVM["fuwa-infra-exploration/infra/docker-compose/telemetry.yml :: victoriametrics service"]',
			'    ISignoz["fuwa-infra-exploration/infra/docker-compose/signoz.yml :: signoz UI and API service"]',
			'    IIngester["fuwa-infra-exploration/infra/docker-compose/signoz/ingester.yaml :: signoz-ingester OTLP receiver"]',
			'    IClick["fuwa-infra-exploration/infra/docker-compose/signoz.yml :: signoz-clickhouse service"]',
			'    IKeeper["fuwa-infra-exploration/infra/docker-compose/signoz/keeper-0.yaml :: signoz-keeper coordination"]',
			'    ISeed["fuwa-infra-exploration/infra/docker-compose/signoz-bootstrap.py :: seed dashboards from infra/signoz-seeds"]',
			'    IVectorCfg --> IBridge',
			'    IVectorCfg --> IVM',
			'    IBridge --> IIngester',
			'    IIngester --> IClick',
			'    IKeeper --> IClick',
			'    ISeed --> ISignoz',
			'    ISignoz --> IClick',
			'  end',
			'  IOpenResty -->|proxy / -> fuwa:8080| IFuwa',
			'  IOpenResty -->|proxy /dash/signoz/| ISignoz',
			'  IOpenResty -->|proxy /dash/vector/| IVectorCfg',
			'  IOpenResty -->|proxy /dash/vmetrics/| IVM',
			'  IOpenResty -->|proxy /dash/clickhouse/| IClick',
			'  IFuwa -->|FUWA_VECTOR_URL POST request JSON| IVectorCfg',
			'  IVectorCfg -->|prometheus_remote_write metrics| IVM',
			'  IVectorCfg -->|raw request JSON over TCP :4321| IBridge',
			'  IBridge -->|OTLP JSON HTTP| IIngester',
			'  %% shell/views/fragments/home.fuwa tmux panel follows this dev stack: fuwa, signoz, signoz-ingester, otlp-bridge, signoz-clickhouse, signoz-keeper, vector-router, victoriametrics.',
			'  %% fuwa-infra-exploration/infra/docker-compose/observability.yml defines an alternate Uptrace-oriented stack, but the current shell/tmux wiring targets dev.yml + signoz.yml + telemetry.yml.'
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

		return window.mermaid.render('arch-diagram-svg-' + tab + '-' + Date.now(), def).then(function (result) {
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
