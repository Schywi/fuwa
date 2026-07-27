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

	/* ── Boot ───────────────────────────────────────────────────────── */

	function boot() {
		if (has_run) { return; }
		has_run = true;

		if (document.readyState !== 'loading') {
			runLoader();
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
		runLoader: runLoader
	};
})();
