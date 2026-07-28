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
	function joinDiagram(lines) {
		return lines.join('\n');
	}

	function activeArchTabName() {
		var active = document.querySelector('.arch-tab--active');
		return active ? active.getAttribute('data-arch-tab') || 'frontend' : 'frontend';
	}

	var mermaidDefinitions = {
		frontend: joinDiagram([
			'flowchart TD',
			'  subgraph Browser["Browser - IDE Shell"]',
			'    direction TD',
			'    BLayout[shell/views/layout.fuwa<br/>vendor + hook loader]',
			'    BHome[shell/views/fragments/home.fuwa<br/>preview + terminal + obs + tmux + arch]',
			'    BWorkspace[shell/views/fragments/workspace.fuwa<br/>stable data-workspace chrome]',
			'    BHTMX[vendor/htmx/htmx-1.9.12.min.js<br/>swap lifecycle]',
			'    BPetite[vendor/petite-vue/petite-vue-0.4.1.iife.js<br/>shell reactivity]',
			'    BGSAP[vendor/gsap/gsap-3.15.0.min.js<br/>loader + panel transitions]',
			'    BEditor[shell/hooks/editor.js<br/>CodeMirror 6 + pendingEdits]',
			'    BWorkspaceHook[shell/hooks/workspace.js<br/>popover state + toggleArch/toggleGrafana/toggleTmux]',
			'    BPreview[shell/hooks/preview.js<br/>preview orchestrator]',
			'    BDriver[shell/hooks/preview-browser.js<br/>iframe relay + ordered tenant queue]',
			'    BSession[shell/hooks/runtime-session.js<br/>files Map + debounce + worker lifecycle]',
			'    BTerminal[shell/hooks/terminal.js<br/>xterm detach/reparent + write()]',
			'    BObs[shell/hooks/observability.js<br/>ring buffer + SSE + appendEvents()]',
			'    BMotion[shell/hooks/motion.js<br/>Mermaid tab renderer + darkroom motion]',
			'    BTmux[shell/hooks/tmux.js<br/>EventSource mux for container logs]',
			'    BCursor[shell/hooks/cursor.js<br/>loupe cursor]',
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
			'    BPreview -->|writeTerminal()| BTerminal',
			'    BDriver -->|create session| BSession',
			'    BSession -->|stdout / stderr| BTerminal',
			'    BSession -->|appendEvents() + POST /__dev/traces| BObs',
			'  end',
			'  subgraph Tenant["Tenant iframe"]',
			'    direction TD',
			'    TTenantHtml[runtime/browser/init.lua<br/>build_runtime_srcdoc() serves /runtime/tenant.html]',
			'    TTenant[shell/hooks/tenant-runtime.js<br/>TenantXMLHttpRequest + swap/reply/stream]',
			'    TDOM[runtime/browser/init.lua<br/>srcdoc #app / phone shell scaffold]',
			'    TPetite[vendor/petite-vue/petite-vue-0.4.1.iife.js<br/>tenant reactivity]',
			'    THTMX[vendor/htmx/htmx-1.9.12.min.js<br/>tenant XHR client]',
			'    TTenantHtml --> TDOM',
			'    TTenantHtml --> TTenant',
			'    TPetite --> TDOM',
			'    THTMX --> TDOM',
			'    TTenant -->|swap HTML + revive scripts| TDOM',
			'  end',
			'  subgraph Worker["Web Worker (Wasmoon)"]',
			'    direction TD',
			'    WWorker[shell/hooks/runtime-worker.js<br/>boot/run queue + in-VM package_web.build()]',
			'    WWasmoon[vendor/wasmoon/wasmoon-1.16.0.js<br/>Lua 5.4 engine]',
			'    WSqlite[vendor/sqlite-wasm/index.mjs<br/>vendor/sqlite-wasm/sqlite3.wasm]',
			'    WPackage[runtime/stdlib/compiler/package_web.lua<br/>same compiler entry in worker + server]',
			'    WTrace[runtime/trace.lua<br/>trace_mod.set_sink -> __fuwa_trace_sink]',
			'    WWorker --> WWasmoon',
			'    WWorker --> WSqlite',
			'    WWorker -->|require() through VFS| WPackage',
			'    WWorker -->|install trace sink| WTrace',
			'  end',
			'  BDriver -->|mount iframe /runtime/tenant.html| TTenantHtml',
			'  BDriver -->|postMessage ping/command/reply| TTenant',
			'  TTenant -->|postMessage ready/request/stream| BDriver',
			'  TDOM -->|user action -> XMLHttpRequest| TTenant',
			'  BSession -->|boot/run + files/sources| WWorker',
			'  WWorker -->|html/stdout/stderr/trace/done| BSession',
			'  BTmux -->|EventSource /__dev/containers/live| PyLogs[runtime/container_logs.py<br/>SSE mux endpoint]',
			'  %% shell/hooks/preview-server.js and shell/hooks/tenant-bridge.js remain legacy route-backed preview helpers and are not loaded by shell/views/layout.fuwa.'
		]),
		backend: joinDiagram([
			'flowchart TD',
			'  subgraph Template["Template layer (.fuwa)"]',
			'    direction TD',
			'    TApp[shell/app.fuwa<br/>GET / · GET /inspect/:payload_id · POST /switch/:payload_id]',
			'    TPage[shell/pages/home.fuwa<br/>Dashboard.build() + ShellViews.render_fragment()]',
			'    TRootView[shell/view.fuwa<br/>include views/layout.fuwa]',
			'    THomeView[shell/views/home.fuwa<br/>include fragments/home.fuwa]',
			'    TLayout[shell/views/layout.fuwa<br/>shell HTML + CSS + vendor imports]',
			'    TFragHome[shell/views/fragments/home.fuwa<br/>preview + terminal/obs/tmux/arch panes]',
			'    TFragWs[shell/views/fragments/workspace.fuwa<br/>command palette + editor form]',
			'    TFragOob[shell/views/fragments/workspace-oob.fuwa<br/>OOB file/status targets]',
			'    TApp --> TPage',
			'    TRootView --> TLayout',
			'    THomeView --> TFragHome',
			'    TPage -->|inspect action renders| TFragWs',
			'    TPage -->|inspect action renders| TFragOob',
			'  end',
			'  subgraph Python["Python dev server"]',
			'    direction TD',
			'    PServer[runtime/dev-server.py<br/>raw sockets + /__dev routes + stdin/stdout bridge]',
			'    PTrace[runtime/dev-server.py<br/>_trace_buffer + SSE subscribers]',
			'    PWatch[runtime/dev-server.py<br/>file_watcher() -> .fuwa-dev/reload-token]',
			'    PLogs[runtime/container_logs.py<br/>docker logs -f reader threads + queue.Queue]',
			'    PServer --> PTrace',
			'    PServer --> PWatch',
			'    PServer -->|/__dev/containers/live| PLogs',
			'  end',
			'  subgraph Lua["Lua CGI handler"]',
			'    direction TD',
			'    LServer[runtime/fuwa-dev.lua<br/>HTTP parse + static assets + payload dispatch]',
			'    LBundle[runtime/fuwa-dev.lua<br/>build_bundle_response() + /runtime/tenant.html]',
			'  end',
			'  subgraph Compiler["Compiler"]',
			'    direction TD',
			'    CPackage[runtime/stdlib/compiler/package_web.lua<br/>build() wrapper + main.lua]',
			'    CInit[runtime/stdlib/compiler/init.lua<br/>compile_runtime_files()]',
			'    CModules[runtime/stdlib/compiler/modules.lua<br/>module/view entry compiler]',
			'    CActions[runtime/stdlib/compiler/actions.lua<br/>render/redirect/fail sugar]',
			'    CRoutes[runtime/stdlib/compiler/routes.lua<br/>routes -> web.app()]',
			'    CView[runtime/stdlib/compiler/view.lua<br/>include expansion + M.render()]',
			'    CImports[runtime/stdlib/compiler/imports.lua<br/>import parsing]',
			'    CSchema[runtime/stdlib/compiler/schema.lua<br/>schema -> model compiler]',
			'    CResponses[runtime/stdlib/compiler/responses.lua<br/>response expression parsing]',
			'    CDiagnostics[runtime/stdlib/compiler/diagnostics.lua<br/>error aggregation]',
			'    CBootstrap[runtime/stdlib/compiler/bootstrap.lua<br/>handle_request() main.lua scaffold]',
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
			'    RWeb[runtime/stdlib/web.lua<br/>app.dispatch() + render_response()]',
			'    RView[runtime/stdlib/view.lua<br/>HTML AST renderer f-if/f-for/&bindings]',
			'    RDb[runtime/stdlib/db.lua<br/>DB facade + provider bridge]',
			'    RSchema[runtime/stdlib/schema.lua<br/>model CRUD + validate]',
			'    RResult[runtime/stdlib/result.lua<br/>Ok/Err helpers]',
			'    RTrace[runtime/trace.lua<br/>trace.span() + sink/scopes]',
			'    RLog[runtime/log.lua<br/>pretty_sink + serialize()]',
			'    HCapabilities[runtime/host/capabilities.lua<br/>describe/list/read/write/compile payload]',
			'    HDashboard[runtime/host/dashboard.lua<br/>workspace data + bundle/runtime URLs]',
			'    HShellViews[runtime/host/shell_views.lua<br/>render_fragment() include expansion]',
			'    HBootstrap[runtime/host/bootstrap.lua<br/>legacy host bootstrap srcdoc]',
			'    HBrowser[runtime/browser/init.lua<br/>bundle.build() + build_runtime_srcdoc()]',
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
			'    IDev[fuwa-infra-exploration/infra/docker-compose/dev.yml<br/>includes app.dev.yml + openresty.yml + signoz.yml + telemetry.yml]',
			'    IOpenResty[fuwa-infra-exploration/infra/openresty/dev/nginx.conf<br/>/ -> fuwa:8080 · /dash/* observability proxies]',
			'    IFuwa[fuwa-infra-exploration/infra/docker-compose/app.dev.yml<br/>fuwa service runs ./dev.sh]',
			'    IDev --> IOpenResty',
			'    IDev --> IFuwa',
			'  end',
			'  subgraph Telemetry["Telemetry + dashboards"]',
			'    direction TD',
			'    IVectorCfg[fuwa-infra-exploration/infra/docker-compose/vector.toml<br/>http_server :8687 + metrics + otlp_bridge sink]',
			'    IBridge[fuwa-infra-exploration/infra/docker-compose/otlp-bridge.py<br/>TCP :4321 JSON -> OTLP HTTP /v1/traces]',
			'    IVM[fuwa-infra-exploration/infra/docker-compose/telemetry.yml<br/>victoriametrics service]',
			'    ISignoz[fuwa-infra-exploration/infra/docker-compose/signoz.yml<br/>signoz UI/API service]',
			'    IIngester[fuwa-infra-exploration/infra/docker-compose/signoz/ingester.yaml<br/>signoz-ingester OTLP receiver :4317/:4318]',
			'    IClick[fuwa-infra-exploration/infra/docker-compose/signoz.yml<br/>signoz-clickhouse service]',
			'    IKeeper[fuwa-infra-exploration/infra/docker-compose/signoz/keeper-0.yaml<br/>signoz-keeper coordination]',
			'    ISeed[fuwa-infra-exploration/infra/docker-compose/signoz-bootstrap.py<br/>seed dashboards from infra/signoz-seeds/*]',
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
		if (mermaidLoaded && window.mermaid) {
			renderArchDiagram(activeArchTabName());
			return;
		}
		if (document.querySelector('script[src*="mermaid"]')) {
			if (window.mermaid) {
				mermaidLoaded = true;
				renderArchDiagram(activeArchTabName());
			}
			return;
		}

		var script = document.createElement('script');
		script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
		script.onload = function () {
			mermaidLoaded = true;
			if (window.mermaid) {
				window.mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: { primaryColor: '#b48cff', primaryTextColor: '#c0caf5', lineColor: '#414868', fontSize: '11px' } });
			}
			renderArchDiagram(activeArchTabName());
		};
		document.head.appendChild(script);
	}

	function renderArchDiagram(tab) {
		if (!window.mermaid) return;
		var el = document.querySelector('[data-arch-diagram]');
		if (!el) return;
		var def = mermaidDefinitions[tab] || '';
		el.innerHTML = '';
		el.removeAttribute('data-processed');
		try {
			window.mermaid.render('arch-diagram-svg', def).then(function (result) {
				el.innerHTML = result.svg;
			});
		} catch (e) {
			el.innerHTML = '<pre style="color:#c0caf5;font-size:0.75rem">' + def + '</pre>';
		}
	}

	document.addEventListener('click', function (e) {
		var tab = e.target.closest('[data-arch-tab]');
		if (!tab) return;
		var name = tab.getAttribute('data-arch-tab');
		if (!name) return;

		document.querySelectorAll('.arch-tab').forEach(function (t) { t.classList.remove('arch-tab--active'); });
		tab.classList.add('arch-tab--active');
		renderArchDiagram(name);
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
		runLoader: runLoader,
		startTypewriter: startTypewriter
	};
})();
