// Behavioural check for the assistant drawer's link routing.
// Run from the repo root: node tests/js/assistant_links.mjs

import assert from 'node:assert/strict';
import { loadShell } from './harness.mjs';

const shell = loadShell();
const { state } = shell;

// 1. deep link from the thread → panel, drawer closed, no default action
state.drawerOpen = true;
state.panelOpen = false;
state.panelUrl = '';
const grafana = 'http://192.168.0.245/explore?left=%5B%5D';
let event = {
	button: 0,
	target: shell.node({ href: grafana }),
	prevented: false,
	stopped: false,
	preventDefault() { this.prevented = true; },
	stopPropagation() { this.stopped = true; }
};
shell.fire('click', event);
assert.equal(event.prevented, true, 'click default must be cancelled (no new tab)');
assert.equal(event.stopped, true, 'click must stop propagating');
assert.equal(state.panelUrl, grafana, 'panel should receive the deep link URL');
assert.equal(state.panelOpen, true, 'panel should open');
assert.equal(state.drawerOpen, false, 'drawer should close so the panel is visible');

// 2. middle click is routed the same way
state.panelOpen = false;
state.panelUrl = '';
event = {
	button: 1,
	target: shell.node({ href: 'http://192.168.0.241/' }),
	prevented: false,
	preventDefault() { this.prevented = true; },
	stopPropagation() {}
};
shell.fire('auxclick', event);
assert.equal(event.prevented, true, 'middle click must not spawn a tab');
assert.equal(state.panelUrl, 'http://192.168.0.241/', 'middle click should open the panel');

// 3. non-navigable schemes are refused, not loaded into the panel
state.panelOpen = false;
state.panelUrl = '';
shell.logs.length = 0;
event = {
	button: 0,
	target: shell.node({ href: 'javascript:alert(1)' }),
	prevented: false,
	preventDefault() { this.prevented = true; },
	stopPropagation() {}
};
shell.fire('click', event);
assert.equal(state.panelOpen, false, 'javascript: must not reach the panel');
assert.equal(event.prevented, true, 'still no navigation');
assert.ok(shell.logs.some((line) => line.includes('assistant:unsupported-link')), 'refusal must be logged');

// 4. links outside the drawer are left alone
state.panelOpen = false;
event = {
	button: 0,
	target: shell.node({ href: 'http://192.168.0.245/', in_drawer: false }),
	prevented: false,
	preventDefault() { this.prevented = true; },
	stopPropagation() {}
};
shell.fire('click', event);
assert.equal(state.panelOpen, false, 'outside the drawer nothing is intercepted');
assert.equal(event.prevented, false, 'outside the drawer the browser default stands');

console.log('assistant links ok: panel only, no tab, no javascript:');
