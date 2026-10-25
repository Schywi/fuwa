// Shared bootstrap for the shell's JS behaviour checks.
//
// The shell's glue lives in an IIFE that expects a browser, so these checks run
// the real `shell/hooks/workspace.js` inside node:vm against a stubbed DOM. No
// browser, no jsdom — only the handful of globals that file touches.

import fs from 'node:fs';
import vm from 'node:vm';

export class Element {}

const SHELL_JS = new URL('../../shell/hooks/workspace.js', import.meta.url);

// A localStorage stub that records what the shell persists; `seed` lets a test
// start with an existing session id.
function storedSession(seed = null) {
	const store = new Map();
	if (seed !== null) store.set('fuwa-assistant-session', seed);
	return {
		store,
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(key, value)
	};
}

export function fakeNode({ href = null, in_drawer = true, drawer = null } = {}) {
	const node = new Element();
	node.href = href;
	node.id = '';
	node.tagName = 'DIV';
	node.hasAttribute = () => false;
	node.matches = () => false;
	node.querySelectorAll = () => [];
	node.getAttribute = (name) => (name === 'href' ? href : null);
	node.closest = (selector) => {
		if (selector === '.assistant-drawer') return in_drawer ? drawer : null;
		if (selector === 'a[href]') return href ? node : null;
		return null;
	};
	return node;
}

function fakeHost() {
	const children = [];
	return {
		children,
		appendChild(child) {
			child.host = children; // so child.remove() can detach itself
			child.parentNode = this; // so insertBefore can place siblings
			children.push(child);
			return child;
		},
		insertBefore(node, ref) {
			node.host = children;
			node.parentNode = this;
			const index = children.indexOf(ref);
			if (index < 0) {
				children.push(node);
			} else {
				children.splice(index, 0, node);
			}
			return node;
		},
		replaceChildren() {
			children.length = 0;
		},
		text() {
			return children.map((child) => child.textContent).join(' | ');
		}
	};
}

export function loadShell({
	window: windowOverrides = {},
	navigator: navigatorOverrides = {},
	frame: frameOverride = null
} = {}) {
	const listeners = [];
	const logs = [];
	const drawer = new Element();
	const toasts = fakeHost();
	const thread = fakeHost();
	const created = [];

	const document = {
		readyState: 'loading',
		body: null,
		addEventListener(type, fn) {
			listeners.push({ type, fn });
		},
		querySelector(selector) {
			if (selector === '[data-assistant-toast]') return toasts;
			if (selector === '[data-assistant-thread]') return thread;
			if (selector === '[data-assistant-frame]') return frameOverride;
			return null;
		},
		querySelectorAll: () => [],
		createElement() {
			const node = new Element();
			node.className = '';
			node.textContent = '';
			node.innerHTML = '';
			node.firstChild = null;
			node.parentNode = { insertBefore() {} };
			node.attributes = {};
			node.setAttribute = function (name, value) {
				this.attributes[name] = String(value);
			};
			node.getAttribute = function (name) {
				return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
			};
			node.removeAttribute = function (name) {
				delete this.attributes[name];
			};
			node.querySelector = () => null;
			node.querySelectorAll = () => [];
			node.children = [];
			node.childNodes = [];
			node.remove = () => {
				const host = node.host;
				if (!Array.isArray(host)) return;
				const index = host.indexOf(node);
				if (index >= 0) host.splice(index, 1);
			};
			created.push(node);
			return node;
		},
		contains: () => false
	};

	const window = {
		URL,
		location: { origin: 'http://192.168.0.244' },
		localStorage: storedSession(),
		setTimeout: () => 0,
		clearTimeout: () => {},
		setInterval: () => 0,
		clearInterval: () => {},
		fetch: () => Promise.reject(new Error('no network in this harness')),
		...windowOverrides
	};

	const consoleSpy = {
		info: (...args) => logs.push(args.join(' ')),
		log: (...args) => logs.push(args.join(' ')),
		warn: (...args) => logs.push(args.join(' ')),
		error: (...args) => logs.push(args.join(' '))
	};

	const source = fs.readFileSync(SHELL_JS, 'utf8');
	vm.runInNewContext(source, {
		window,
		document,
		Element,
		HTMLElement: Element,
		HTMLInputElement: class extends Element {},
		HTMLSelectElement: class extends Element {},
		console: consoleSpy,
		performance: { now: () => 0 },
		navigator: navigatorOverrides,
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

	const state = window.FuwaShellWorkspace && window.FuwaShellWorkspace.state;
	if (!state) {
		throw new Error('shell did not expose FuwaShellWorkspace.state');
	}

	return {
		window,
		state,
		listeners,
		logs,
		toasts,
		thread,
		created,
		node: (options) => fakeNode({ ...options, drawer }),
		fire(type, event) {
			for (const listener of listeners) {
				if (listener.type === type) listener.fn(event);
			}
		}
	};
}

// Resolves once the microtask queue has drained, so `.then` chains started by
// the shell have run before assertions.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Deterministic timers: nothing fires until the test runs it, so a 429 retry
// can be exercised without sleeping for the Retry-After delay.
export function fakeScheduler() {
	const timeouts = [];
	const intervals = [];
	return {
		timeouts,
		intervals,
		window: {
			setTimeout(fn, ms) {
				timeouts.push({ fn, ms });
				return timeouts.length;
			},
			clearTimeout() {},
			setInterval(fn, ms) {
				intervals.push({ fn, ms });
				return intervals.length;
			},
			clearInterval() {}
		},
		runTimeouts() {
			const pending = timeouts.splice(0, timeouts.length);
			for (const timer of pending) timer.fn();
		},
		tickIntervals() {
			for (const timer of intervals) timer.fn();
		}
	};
}
