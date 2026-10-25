// Behavioural check that module-level actions drive petite-vue's reactive scope.
//
// petite-vue wraps the initial data in its own Proxy (createApp → reactive).
// The object this module keeps is the raw target, so writing to it updates data
// but notifies nothing: a clicked evidence link changed panelUrl/panelOpen in
// memory and the UI never re-rendered. Template-invoked handlers receive the
// proxy as `this`; module-level handlers (deep links, frame clicks) must reuse
// it.
//
// Run from the repo root: node tests/js/assistant_scope.mjs

import assert from 'node:assert/strict';
import { loadShell } from './harness.mjs';

// Stands in for the proxy petite-vue hands to template handlers: distinct
// identity from the raw state object, and it records what was done through it.
function reactiveProxyStub(calls) {
	return {
		drawerOpen: true,
		panelOpen: false,
		panelUrl: '',
		assistantInput: '',
		assistantBusy: false,
		closeDrawer() {
			calls.push('closeDrawer');
			this.drawerOpen = false;
		},
		openPanel(url) {
			calls.push('openPanel:' + url);
			this.panelUrl = url;
			this.panelOpen = true;
		},
		// openDrawer probes health; the stub only needs it to exist.
		probeAssistantHealth() {}
	};
}

// ── 1. a deep link reaches the panel through the captured scope ──────────
{
	const shell = loadShell();
	const calls = [];
	const proxy = reactiveProxyStub(calls);

	// What the header button does: the template invokes a state method, so `this`
	// is the reactive scope. That is our only chance to learn it.
	shell.state.openDrawer.call(proxy);
	assert.equal(proxy.drawerOpen, true, 'openDrawer ran on the proxy');

	// The drawer renders an answer, then a link is clicked. The delegated handler
	// only has the raw object, which is exactly the failing path.
	const link = shell.node({ href: 'http://192.168.0.245/explore?left=%5B%5D' });
	let prevented = false;
	shell.fire('click', {
		button: 0,
		target: link,
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {}
	});

	assert.equal(prevented, true, 'the click must not navigate the page');
	assert.deepEqual(calls, ['closeDrawer', 'openPanel:http://192.168.0.245/explore?left=%5B%5D'], 'panel action went through the reactive scope');
	assert.equal(proxy.panelOpen, true, 'the proxy — and therefore the UI — sees the panel open');
	assert.equal(proxy.panelUrl, 'http://192.168.0.245/explore?left=%5B%5D', 'with the deep link URL');

	// The raw object must not be the thing being mutated: that is the bug.
	assert.equal(shell.state.panelOpen, false, 'the raw state must not be used for UI mutations');
	assert.equal(shell.state.drawerOpen, false, 'raw drawer state stays untouched');
}

// ── 2. the same path is used by the embedded-page fallback ──────────────
{
	const calls = [];
	const proxy = reactiveProxyStub(calls);
	const doc = {
		querySelectorAll: () => [],
		addEventListener(type, fn) {
			doc.listener = fn;
		}
	};
	const shell = loadShell({ frame: { contentDocument: doc } });

	shell.state.openDrawer.call(proxy);
	shell.state.bindAssistantFrame();

	const anchor = shell.node({ href: 'http://192.168.0.241/' });
	doc.listener({
		target: anchor,
		preventDefault() {},
		stopPropagation() {}
	});

	assert.deepEqual(calls, ['closeDrawer', 'openPanel:http://192.168.0.241/'], 'frame links use the same scope');
	assert.equal(proxy.panelOpen, true, 'and open the panel');
}

// ── 3. without a captured scope nothing throws ──────────────────────────
{
	const shell = loadShell();
	const link = shell.node({ href: 'http://192.168.0.245/' });
	let prevented = false;
	shell.fire('click', {
		button: 0,
		target: link,
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {}
	});

	assert.equal(prevented, true, 'the click is still intercepted before any template interaction');
	assert.equal(shell.state.panelOpen, true, 'and falls back to the raw state rather than dropping the action');
}

console.log('assistant scope ok: deep links mutate the reactive scope, not the raw object');
