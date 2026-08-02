'use strict';

const reduce_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch_device = window.matchMedia('(pointer: coarse)').matches;
const cursor_enabled = !(reduce_motion || touch_device);
const LOG_PREFIX = '[shell:cursor]';

let dot = null;
let ring = null;
let mouse = { x: 0, y: 0 };
let dot_pos = { x: 0, y: 0 };
let ring_pos = { x: 0, y: 0 };
let ring_scale = 1;
let ring_target_scale = 1;
let mounted = false;
let raf_id = null;

function log(step, detail) {
	if (detail === undefined) {
		console.info(LOG_PREFIX + ' ' + step);
		return;
	}
	console.info(LOG_PREFIX + ' ' + step, detail);
}

function onMouseMove(event) {
	mouse.x = event.clientX;
	mouse.y = event.clientY;
}

function isInteractive(element) {
	if (!(element instanceof Element)) return false;
	const tag = element.tagName.toLowerCase();
	if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') {
		return true;
	}
	if (element.hasAttribute('data-file-path')) return true;
	if (element.closest('[data-develop-btn]')) return true;
	if (element.closest('[data-view-toggle]')) return true;
	if (element.closest('[data-film-strip-project]')) return true;
	return false;
}

function onMouseOver(event) {
	if (isInteractive(event.target)) {
		ring_target_scale = 2.4;
		if (ring) ring.style.borderColor = 'rgba(216,162,74,0.55)';
	}
}

function onMouseOut(event) {
	if (isInteractive(event.target)) {
		ring_target_scale = 1;
		if (ring) ring.style.borderColor = 'rgba(245,240,232,0.45)';
	}
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function update() {
	if (!mounted) return;

	const lerp_factor = 0.18;

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

export function mount() {
	if (!cursor_enabled || mounted) return;
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

export function unmount() {
	if (!cursor_enabled) return;
	mounted = false;

	if (raf_id) {
		cancelAnimationFrame(raf_id);
		raf_id = null;
	}

	document.removeEventListener('mousemove', onMouseMove);
	document.removeEventListener('mouseover', onMouseOver);
	document.removeEventListener('mouseout', onMouseOut);

	if (dot) {
		dot.remove();
		dot = null;
	}
	if (ring) {
		ring.remove();
		ring = null;
	}

	log('unmounted');
}

if (cursor_enabled) {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { mount(); }, { once: true });
	} else {
		mount();
	}

	document.addEventListener('htmx:beforeSwap', function (event) {
		const target = event.detail?.target || event.detail?.elt;
		if (target instanceof Element && target.id === 'shell-content') {
			unmount();
		}
	});

	document.addEventListener('htmx:afterSwap', function (event) {
		const target = event.detail?.target || event.detail?.elt;
		if (target instanceof Element && target.id === 'shell-content') {
			mount();
		}
	});
}
