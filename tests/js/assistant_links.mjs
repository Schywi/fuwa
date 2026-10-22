// Behavioural check for the assistant drawer's link routing. Runs the real
// shell/hooks/workspace.js in a stubbed DOM (no browser): every deep link must
// open the fuwa panel and none may open a tab. Run from the repo root: node tests/js/assistant_links.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('shell/hooks/workspace.js', 'utf8');
const listeners = [];
const logs = [];

class Element {}

function makeNode({ href = null, in_drawer = true } = {}) {
	const node = new Element();
	node.href = href;
	node.getAttribute = (name) => (name === 'href' ? href : null);
	node.closest = (selector) => {
		if (selector === '.assistant-drawer') return in_drawer ? drawer : null;
		if (selector === 'a[href]') return href ? node : null;
		return null;
	};
	return node;
}

const drawer = new Element();
const document = {
	readyState: 'loading',
	body: null,
	addEventListener(type, fn) { listeners.push({ type, fn }); },
	querySelector() { return null; },
	contains() { return false; }
};
const localStorage = { getItem: () => null, setItem: () => {} };
const window = {
	localStorage,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	fetch: () => Promise.reject(new Error('no network in this harness'))
};
const consoleSpy = {
	info: (...args) => logs.push(args.join(' ')),
	log: (...args) => logs.push(args.join(' ')),
	warn: (...args) => logs.push(args.join(' ')),
	error: (...args) => logs.push(args.join(' '))
};

vm.runInNewContext(source, {
	window,
	document,
	Element,
	HTMLElement: Element,
	HTMLInputElement: class extends Element {},
	HTMLSelectElement: class extends Element {},
	console: consoleSpy,
	performance: { now: () => 0 },
	navigator: {},
	URLSearchParams,
	queueMicrotask,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	WeakSet,
	Promise,
	Date,
	Math,
	String,
	JSON
});

const state = window.FuwaShellWorkspace.state;
assert.ok(state, 'expected FuwaShellWorkspace.state');

function fire(type, { href, button = 0, in_drawer = true } = {}) {
	let prevented = false;
	let stopped = false;
	const event = {
		button,
		target: makeNode({ href, in_drawer }),
		preventDefault() { prevented = true; },
		stopPropagation() { stopped = true; }
	};
	for (const listener of listeners) {
		if (listener.type === type) listener.fn(event);
	}
	return { prevented, stopped };
}

// 1. deep link from the thread → panel, drawer closed, no default action
state.drawerOpen = true;
state.panelOpen = false;
state.panelUrl = '';
const grafana = 'http://192.168.0.245/explore?left=%5B%5D';
let result = fire('click', { href: grafana });
assert.equal(result.prevented, true, 'click default must be cancelled (no new tab)');
assert.equal(result.stopped, true, 'click must stop propagating');
assert.equal(state.panelUrl, grafana, 'panel should receive the deep link URL');
assert.equal(state.panelOpen, true, 'panel should open');
assert.equal(state.drawerOpen, false, 'drawer should close so the panel is visible');

// 2. middle click is routed the same way
state.panelOpen = false;
state.panelUrl = '';
result = fire('auxclick', { href: 'http://192.168.0.241/', button: 1 });
assert.equal(result.prevented, true, 'middle click must not spawn a tab');
assert.equal(state.panelUrl, 'http://192.168.0.241/', 'middle click should open the panel');

// 3. non-navigable schemes are refused, not loaded into the panel
state.panelOpen = false;
state.panelUrl = '';
logs.length = 0;
result = fire('click', { href: 'javascript:alert(1)' });
assert.equal(state.panelOpen, false, 'javascript: must not reach the panel');
assert.equal(result.prevented, true, 'still no navigation');
assert.ok(logs.some((line) => line.includes('assistant:unsupported-link')), 'refusal must be logged');

// 4. links outside the drawer are left alone
logs.length = 0;
state.panelOpen = false;
fire('click', { href: 'http://192.168.0.245/', in_drawer: false });
assert.equal(state.panelOpen, false, 'outside the drawer nothing is intercepted');

console.log('click routing ok: panel only, no tab, no javascript:');
