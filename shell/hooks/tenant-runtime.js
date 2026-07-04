(function () {
	'use strict';

	// Tenant-side bridge for the browser runtime preview. Runs inside the
	// sandboxed tenant iframe served at /runtime/tenant.html. Talks to the host
	// page over postMessage using the __fuwaTenant envelope:
	//   host -> tenant: { type: 'ping' } | { type: 'command', command }
	//   tenant -> host: { type: 'ready' | 'request' | 'meta' | 'stream' }
	// Commands mirror runtime/browser/init.lua contract.tenant_commands.

	const ROOT = document.getElementById('app');
	const state = {
		path: '/',
		title: 'runtime'
	};
	const pendingReplies = new Map();
	let requestId = 0;

	function post(payload) {
		window.parent.postMessage(Object.assign({ __fuwaTenant: true }, payload), '*');
	}

	function escapeHtml(value) {
		return String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;');
	}

	function htmxApi() {
		return window.htmx && typeof window.htmx.swap === 'function' ? window.htmx : null;
	}

	function emitMeta() {
		post({ type: 'meta', title: state.title, path: state.path });
	}

	function normalizePath(input) {
		try {
			if (String(input).startsWith('/')) {
				return String(input);
			}
			const url = new URL(String(input), 'https://tenant.invalid' + (state.path || '/'));
			return url.pathname + url.search + url.hash;
		} catch (error) {
			return '/';
		}
	}

	function processTenantDom(scope) {
		if (window.PetiteVue && typeof window.PetiteVue.createApp === 'function' && scope instanceof Element) {
			try {
				window.PetiteVue.createApp().mount(scope);
			} catch (error) {
				console.error('[tenant] petite-vue mount failed', error);
			}
		}

		const htmx = htmxApi();
		if (htmx && htmx.config) {
			htmx.config.allowScriptTags = false;
		}
		if (htmx && typeof htmx.process === 'function' && scope instanceof Element) {
			htmx.process(scope);
		}
	}

	function deriveTitle(command) {
		if (command.title) {
			return command.title;
		}
		const heading = ROOT?.querySelector('h1, h2')?.textContent?.trim();
		return heading || 'runtime';
	}

	function updateTitleAndPath(command) {
		state.path = command.path || state.path || '/';
		state.title = deriveTitle(command);
		document.title = state.title;
		emitMeta();
	}

	// innerHTML never executes <script> tags; re-create each one so tenant
	// scripts run, then mount reactive frameworks once they're done.
	function reviveTenantScripts(scriptNodes, done) {
		let pending = 0;
		let finished = false;
		const maybeDone = function () {
			if (finished || pending > 0) {
				return;
			}
			finished = true;
			done();
		};

		for (const old of scriptNodes) {
			const fresh = document.createElement('script');
			for (const attr of Array.from(old.attributes)) {
				fresh.setAttribute(attr.name, attr.value);
			}
			fresh.textContent = old.textContent;
			if (old.src) {
				pending += 1;
				const settle = function () {
					pending -= 1;
					maybeDone();
				};
				fresh.addEventListener('load', settle, { once: true });
				fresh.addEventListener('error', settle, { once: true });
			}
			ROOT.appendChild(fresh);
		}

		maybeDone();
	}

	function swapHtml(command) {
		if (!ROOT) {
			return;
		}
		const html = command.html || '';

		const holder = document.createElement('div');
		holder.innerHTML = html;
		const scriptNodes = Array.from(holder.querySelectorAll('script'));

		ROOT.innerHTML = html;
		for (const stale of Array.from(ROOT.querySelectorAll('script'))) {
			stale.remove();
		}

		reviveTenantScripts(scriptNodes, function () {
			processTenantDom(ROOT);
			updateTitleAndPath(command);
		});
	}

	function handleClear(command) {
		if (!ROOT) {
			return;
		}
		ROOT.innerHTML =
			'<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;color:#5b6472;font-family:system-ui,sans-serif;">' +
			'<p>' + escapeHtml(command.message || 'Run code to render.') + '</p>' +
			'</div>';
		state.title = 'runtime';
		state.path = '/';
		document.title = state.title;
		emitMeta();
	}

	function handleStream(command) {
		const sinks = ROOT?.querySelectorAll('[data-stream="' + command.stream + '"]') ?? [];
		for (const sink of sinks) {
			sink.textContent = (sink.textContent || '') + command.text;
		}
		document.dispatchEvent(new CustomEvent('fuwa:stream', { detail: command }));
	}

	function serializeBody(body) {
		if (typeof body === 'string') {
			return body;
		}
		if (body instanceof URLSearchParams) {
			return body.toString();
		}
		if (body instanceof FormData) {
			return new URLSearchParams(body).toString();
		}
		if (body == null) {
			return '';
		}
		return String(body);
	}

	// htmx issues XMLHttpRequests; route them to the worker runtime through
	// the host instead of the network.
	class TenantXMLHttpRequest extends EventTarget {
		constructor() {
			super();
			this.upload = new EventTarget();
			this.readyState = 0;
			this.status = 0;
			this.statusText = '';
			this.responseText = '';
			this.response = '';
			this.responseURL = '';
			this.timeout = 0;
			this.withCredentials = false;
			this.headers = {};
			this.responseHeaders = {};
			this.method = 'GET';
			this.url = '/';
			this.fuwaMeta = null;
			this.aborted = false;
			this.onload = null;
			this.onerror = null;
			this.onabort = null;
			this.onreadystatechange = null;
			this.onloadend = null;
		}

		open(method, url) {
			this.method = method || 'GET';
			this.url = url || '/';
			this.readyState = 1;
			this.emitEvent('readystatechange');
		}

		setRequestHeader(name, value) {
			this.headers[name] = value;
		}

		getResponseHeader(name) {
			return this.responseHeaders[name.toLowerCase()] || null;
		}

		getAllResponseHeaders() {
			return Object.entries(this.responseHeaders)
				.map(function (entry) {
					return entry[0] + ': ' + entry[1];
				})
				.join('\r\n');
		}

		overrideMimeType() {}

		abort() {
			this.aborted = true;
			this.emitEvent('abort');
			this.emitEvent('loadend');
		}

		emitEvent(type) {
			const event = new Event(type);
			this.dispatchEvent(event);
			const handler = this['on' + type];
			if (typeof handler === 'function') {
				handler.call(this, event);
			}
		}

		finish(reply) {
			if (this.aborted) {
				return;
			}
			this.status = reply.status || 200;
			this.statusText = 'OK';
			this.responseText = reply.html || '';
			this.response = this.responseText;
			this.responseURL = reply.path || this.url;
			this.fuwaMeta = { title: reply.title, path: reply.path };
			this.readyState = 2;
			this.emitEvent('readystatechange');
			this.readyState = 4;
			this.emitEvent('readystatechange');
			this.emitEvent('load');
			this.emitEvent('loadend');
		}

		send(body) {
			if (this.aborted) {
				return;
			}
			requestId += 1;
			const currentRequestId = requestId;
			const path = normalizePath(this.url);
			const self_request = this;
			pendingReplies.set(currentRequestId, function (command) {
				pendingReplies.delete(currentRequestId);
				self_request.finish(command);
			});

			post({
				type: 'request',
				requestId: currentRequestId,
				method: (this.method || 'GET').toUpperCase(),
				path: path,
				body: serializeBody(body)
			});
		}
	}

	window.XMLHttpRequest = TenantXMLHttpRequest;

	window.addEventListener('message', function (event) {
		const message = event.data;
		if (!message || message.__fuwaTenant !== true) {
			return;
		}

		if (message.type === 'ping') {
			post({ type: 'ready' });
			return;
		}

		if (message.type !== 'command') {
			return;
		}

		const command = message.command;
		if (!command || typeof command.type !== 'string') {
			return;
		}

		if (command.type === 'reply') {
			pendingReplies.get(command.requestId)?.(command);
			return;
		}
		if (command.type === 'clear') {
			handleClear(command);
			return;
		}
		if (command.type === 'swap') {
			swapHtml(command);
			return;
		}
		if (command.type === 'stream') {
			handleStream(command);
		}
	});

	document.addEventListener('htmx:afterSwap', function (event) {
		processTenantDom(ROOT);
		const xhr = event.detail?.xhr;
		if (xhr && xhr.fuwaMeta) {
			updateTitleAndPath(xhr.fuwaMeta);
		} else {
			updateTitleAndPath({});
		}
	});

	handleClear({ type: 'clear', message: 'Run code to render.' });
	post({ type: 'ready' });
})();
