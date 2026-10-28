// Behavioural check for LB deep-link routing.
//
// The assistant emits absolute LoadBalancer URLs. Argo refuses framing and only
// serves its SPA at "/", so its link has to be rewritten onto fuwa's own
// /argocd/ proxy; Kargo gets the same treatment through /kargo/.
// Run from the repo root: node tests/js/assistant_routing.mjs

import assert from 'node:assert/strict';
import { loadShell } from './harness.mjs';

const shell = loadShell({ window: { location: { origin: 'http://192.168.0.244' } } });
const route = shell.window.FuwaShellWorkspace.assistantRoutedUrl;

// ── 1. the two LoadBalancers are mapped onto same-origin proxies ─────────
assert.equal(route('http://192.168.0.247'), '/argocd/', 'argocd root → proxied panel');
assert.equal(route('http://192.168.0.247/'), '/argocd/', 'argocd root with slash');
assert.equal(
	route('http://192.168.0.247/applications/argocd'),
	'/argocd/',
	'argocd deep paths collapse to the SPA root, because the server 404s them'
);
assert.equal(route('http://192.168.0.249/projects'), '/kargo/projects', 'kargo keeps its path');
assert.equal(route('http://192.168.0.249/project/pilot?x=1'), '/kargo/project/pilot?x=1', 'path and query survive');

// ── 2. everything else is untouched ─────────────────────────────────────
assert.equal(route('http://192.168.0.245/explore?x=1'), 'http://192.168.0.245/explore?x=1', 'grafana stays absolute');
assert.equal(route('http://192.168.0.250/'), 'http://192.168.0.250/', 'sandboxes stay absolute');
assert.equal(route('/assistant/audio/a'), '/assistant/audio/a', 'relative stays relative');
assert.equal(route('mailto:x@y'), 'mailto:x@y', 'non-http is passed through');

// ── 3. a click actually opens the mapped panel ───────────────────────────
{
	const state = shell.state;
	state.drawerOpen = true;
	state.panelOpen = false;
	state.panelUrl = '';

	const link = shell.node({ href: 'http://192.168.0.247/applications/argocd' });
	let prevented = false;
	shell.fire('click', {
		button: 0,
		target: link,
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {}
	});

	assert.equal(prevented, true, 'the click never navigates');
	assert.equal(state.panelUrl, '/argocd/', 'the panel opens the proxied Argo, not the bare LB');
	assert.equal(state.panelOpen, true, 'panel opened');
	assert.ok(shell.logs.some((line) => line.includes('assistant:routed')), 'the rewrite is logged');
}

console.log('assistant routing ok: LB deep links land on same-origin proxies');
