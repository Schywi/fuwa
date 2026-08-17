(function () {
	'use strict';

	// Loupe cursor: a dot + trailing ring at mix-blend-mode: difference.
	// Expands on interactive elements. Respects reduced-motion and touch.

	var reduce_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var touch_device = window.matchMedia('(pointer: coarse)').matches;

	if (reduce_motion || touch_device) { return; }

	var LOG_PREFIX = '[shell:cursor]';

	var dot = null;
	var ring = null;
	var mouse = { x: 0, y: 0 };
	var dot_pos = { x: 0, y: 0 };
	var ring_pos = { x: 0, y: 0 };
	var ring_scale = 1;
	var ring_target_scale = 1;
	var mounted = false;
	var raf_id = null;

	function log(step, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX + ' ' + step);
			return;
		}
		console.info(LOG_PREFIX + ' ' + step, detail);
	}

	function mount() {
		if (mounted) { return; }
		mounted = true;

		dot = document.createElement('div');
		dot.style.cssText = [
			'position: fixed',
			'top: 0',
			'left: 0',
			'width: 7px',
			'height: 7px',
			'border-radius: 50%',
			'background: #f5f0e8',
			'pointer-events: none',
			'z-index: 9998',
			'mix-blend-mode: difference',
			'will-change: transform',
			'transform: translate(-50%, -50%)'
		].join(';');
		document.body.appendChild(dot);

		ring = document.createElement('div');
		ring.style.cssText = [
			'position: fixed',
			'top: 0',
			'left: 0',
			'width: 32px',
			'height: 32px',
			'border-radius: 50%',
			'border: 1px solid rgba(245,240,232,0.45)',
			'pointer-events: none',
			'z-index: 9997',
			'mix-blend-mode: difference',
			'will-change: transform',
			'transform: translate(-50%, -50%)'
		].join(';');
		document.body.appendChild(ring);

		document.addEventListener('mousemove', onMouseMove, { passive: true });
		document.addEventListener('mouseover', onMouseOver, { passive: true });
		document.addEventListener('mouseout', onMouseOut, { passive: true });

		raf_id = requestAnimationFrame(update);

		log('mounted');
	}

	function unmount() {
		mounted = false;

		if (raf_id) { cancelAnimationFrame(raf_id); raf_id = null; }

		document.removeEventListener('mousemove', onMouseMove);
		document.removeEventListener('mouseover', onMouseOver);
		document.removeEventListener('mouseout', onMouseOut);

		if (dot) { dot.remove(); dot = null; }
		if (ring) { ring.remove(); ring = null; }

		log('unmounted');
	}

	function onMouseMove(event) {
		mouse.x = event.clientX;
		mouse.y = event.clientY;
	}

	function isInteractive(el) {
		if (!(el instanceof Element)) { return false; }
		var tag = el.tagName.toLowerCase();
		if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') {
			return true;
		}
		if (el.hasAttribute('data-file-path')) { return true; }
		if (el.closest('[data-develop-btn]')) { return true; }
		if (el.closest('[data-view-toggle]')) { return true; }
		if (el.closest('[data-film-strip-project]')) { return true; }
		return false;
	}

	function onMouseOver(event) {
		if (isInteractive(event.target)) {
			ring_target_scale = 2.4;
			if (ring) { ring.style.borderColor = 'rgba(216,162,74,0.55)'; }
		}
	}

	function onMouseOut(event) {
		if (isInteractive(event.target)) {
			ring_target_scale = 1;
			if (ring) { ring.style.borderColor = 'rgba(245,240,232,0.45)'; }
		}
	}

	function lerp(a, b, t) {
		return a + (b - a) * t;
	}

	function update() {
		if (!mounted) { return; }

		var lerp_factor = 0.18;

		dot_pos.x = lerp(dot_pos.x, mouse.x, lerp_factor);
		dot_pos.y = lerp(dot_pos.y, mouse.y, lerp_factor);

		ring_pos.x = lerp(ring_pos.x, mouse.x, lerp_factor * 0.7);
		ring_pos.y = lerp(ring_pos.y, mouse.y, lerp_factor * 0.7);

		ring_scale = lerp(ring_scale, ring_target_scale, 0.12);

		if (dot) {
			dot.style.transform = 'translate3d(' + dot_pos.x + 'px, ' + dot_pos.y + 'px, 0) translate(-50%, -50%)';
		}
		if (ring) {
			ring.style.transform = 'translate3d(' + ring_pos.x + 'px, ' + ring_pos.y + 'px, 0) translate(-50%, -50%) scale(' + ring_scale + ')';
		}

		raf_id = requestAnimationFrame(update);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { mount(); }, { once: true });
	} else {
		mount();
	}

	// Re-mount on shell-content swaps
	document.addEventListener('htmx:beforeSwap', function (event) {
		var target = event.detail?.target || event.detail?.elt;
		if (target instanceof Element && target.id === 'shell-content') {
			unmount();
		}
	});

	document.addEventListener('htmx:afterSwap', function (event) {
		var target = event.detail?.target || event.detail?.elt;
		if (target instanceof Element && target.id === 'shell-content') {
			mount();
		}
	});

	window.FuwaShellCursor = {
		mount: mount,
		unmount: unmount
	};
})();
