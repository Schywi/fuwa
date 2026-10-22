// Behavioural check for the simple fallback: the assistant's own page embedded
// same-origin, with its links stolen into the fuwa panel.
// Run from the repo root: node tests/js/assistant_fallback.mjs

import assert from 'node:assert/strict';
import { Element, loadShell, settle } from './harness.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeFrameDocument() {
	const listeners = [];
	const anchors = [
		{ href: 'http://192.168.0.245/explore', removed: [], removeAttribute(name) { this.removed.push(name); }, getAttribute: () => null },
		{ href: 'http://192.168.0.241/', removed: [], removeAttribute(name) { this.removed.push(name); }, getAttribute: () => null }
	];
	return {
		listeners,
		anchors,
		querySelectorAll(selector) {
			return selector === 'a[target]' ? anchors : [];
		},
		addEventListener(type, fn, capture) {
			listeners.push({ type, fn, capture });
		}
	};
}

// ── 1. frame links open the panel, and no anchor keeps a target ───────────
{
	const doc = fakeFrameDocument();
	const shell = loadShell({ frame: { contentDocument: doc } });

	shell.state.drawerOpen = true;
	shell.state.bindAssistantFrame();

	assert.equal(doc.anchors[0].removed.includes('target'), true, 'target stripped so nothing tabs out');
	assert.equal(doc.anchors[1].removed.includes('target'), true, 'every anchor, not just the first');
	const listener = doc.listeners.find((entry) => entry.type === 'click');
	assert.ok(listener, 'a click handler is installed on the frame document');
	assert.equal(listener.capture, true, 'in the capture phase, before the page handles it');

	const anchor = new Element();
	anchor.href = 'http://192.168.0.245/explore?left=%5B%5D';
	anchor.closest = (selector) => (selector === 'a[href]' ? anchor : null);
	let prevented = false;
	let stopped = false;
	listener.fn({
		target: anchor,
		preventDefault() { prevented = true; },
		stopPropagation() { stopped = true; }
	});

	assert.equal(prevented, true, 'the frame does not navigate');
	assert.equal(stopped, true, 'the page does not see the click');
	assert.equal(shell.state.panelUrl, 'http://192.168.0.245/explore?left=%5B%5D', 'the panel receives the link');
	assert.equal(shell.state.panelOpen, true, 'panel opened');
	assert.equal(shell.state.drawerOpen, false, 'drawer closed so the panel is visible');
}

// ── 2. a cross-origin frame is reported, not silently broken ─────────────
{
	const shell = loadShell({ frame: { contentDocument: null } });
	shell.state.bindAssistantFrame();
	assert.ok(
		shell.toasts.text().includes('not same-origin'),
		'the user is told why links would open tabs'
	);
	assert.equal(shell.state.panelOpen, false, 'nothing was opened');
}

// ── 3. an unusable fragment endpoint switches to the fallback ────────────
{
	const shell = loadShell({
		window: {
			fetch: () => Promise.resolve({ ok: false, status: 405, headers: { get: () => null }, text: () => Promise.resolve('') })
		}
	});

	assert.equal(shell.state.assistantFallback, false, 'native mode by default');
	shell.state.assistantInput = 'hello';
	shell.state.sendAssistant();
	await settle();

	assert.equal(shell.state.assistantFallback, true, '405 means the fragment path is unusable → embed the page');
	assert.ok(
		shell.logs.some((line) => line.includes('assistant:fallback-on')),
		'the switch is logged'
	);
}

// ── 4. a transient 500 does not switch modes ─────────────────────────────
{
	const shell = loadShell({
		window: {
			fetch: () => Promise.resolve({ ok: false, status: 500, headers: { get: () => null }, text: () => Promise.resolve('') })
		}
	});
	shell.state.assistantInput = 'hello';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.state.assistantFallback, false, 'a server error is an error, not a mode change');
}

// ── 5. the manual switch is idempotent and keeps its first reason ────────
{
	const shell = loadShell();
	shell.state.useAssistantFallback();
	assert.equal(shell.state.assistantFallback, true, 'manual switch works');
	assert.equal(shell.state.assistantFallbackReason, 'manual', 'reason recorded');
	shell.state.enableAssistantFallback('later');
	assert.equal(shell.state.assistantFallbackReason, 'manual', 'the first reason is kept');
	await tick();
}

console.log('assistant fallback ok: embedded page, links stolen, dead fragment endpoint switches over');
