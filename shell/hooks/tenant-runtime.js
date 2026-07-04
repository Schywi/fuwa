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
		title: 'runtime',
		appBasePath: typeof window.__FUWA_APP_BASE_PATH__ === 'string' ? window.__FUWA_APP_BASE_PATH__ : ''
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
		const base = state.path || '/';
		try {
			const text = String(input);
			if (text.startsWith('#') || text.startsWith('javascript:') || text.startsWith('data:')) {
				return text;
			}
			if (text.startsWith('//')) {
				const url = new URL(text, window.location.href);
				return rebaseAppPath(url.pathname + url.search + url.hash, state.appBasePath);
			}
			if (isAbsoluteUrl(text)) {
				const url = new URL(text);
				return rebaseAppPath(url.pathname + url.search + url.hash, state.appBasePath);
			}
			if (text.startsWith('/')) {
				return rebaseAppPath(text, state.appBasePath);
			}
			const url = new URL(text, 'https://tenant.invalid' + (base.startsWith('/') ? base : '/' + base));
			return rebaseAppPath(url.pathname + url.search + url.hash, state.appBasePath);
		} catch (error) {
			return '/';
		}
	}

	function normalizeAppBasePath(appBasePath) {
		const trimmed = typeof appBasePath === 'string' ? appBasePath.trim() : '';
		if (trimmed === '' || trimmed === '/') {
			return '';
		}
		return trimmed.endsWith('/') ? trimmed : trimmed + '/';
	}

	function isAbsoluteUrl(value) {
		return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith('//');
	}

	function rebaseAppPath(path, appBasePath) {
		const normalized = normalizeAppBasePath(appBasePath);
		if (!path || isAbsoluteUrl(path) || !path.startsWith('/')) {
			return path;
		}
		if (!normalized) {
			return path;
		}
		if (path === normalized || path.startsWith(normalized)) {
			return path;
		}
		return normalized + path.replace(/^\/+/, '');
	}

	function resolveUrl(value, baseUrl) {
		const text = typeof value === 'string' ? value.trim() : '';
		if (text === '' || text.startsWith('#') || text.startsWith('javascript:') || text.startsWith('data:') || isAbsoluteUrl(text)) {
			return text;
		}
		try {
			const base = new URL(String(baseUrl || '/'), window.location.href);
			const url = new URL(text, base);
			return url.pathname + url.search + url.hash;
		} catch (error) {
			return text;
		}
	}

	function rewriteDocumentUrls(root, baseUrl, appBasePath) {
		if (!(root instanceof Element)) {
			return;
		}

		const attribute_names = [
			'href',
			'src',
			'action',
			'formaction',
			'hx-get',
			'hx-post',
			'hx-put',
			'hx-patch',
			'hx-delete',
			'hx-push-url',
			'hx-replace-url',
			'data-hx-get',
			'data-hx-post',
			'data-hx-put',
			'data-hx-patch',
			'data-hx-delete'
		];

		for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
			for (const attributeName of attribute_names) {
				if (!element.hasAttribute(attributeName)) {
					continue;
				}
				const value = element.getAttribute(attributeName);
				if (!value || value === '' || value.startsWith('#') || value.startsWith('javascript:') || value.startsWith('data:')) {
					continue;
				}
				if ((attributeName === 'hx-push-url' || attributeName === 'hx-replace-url') && (value === 'true' || value === 'false')) {
					continue;
				}
				const rebasedValue = value.startsWith('/') ? rebaseAppPath(value, appBasePath) : value;
				element.setAttribute(attributeName, resolveUrl(rebasedValue, baseUrl));
			}
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
		state.path = command.responseUrl || command.path || state.path || '/';
		if (command.appBasePath) {
			state.appBasePath = normalizeAppBasePath(command.appBasePath);
		}
		state.title = deriveTitle(command);
		document.title = state.title;
		emitMeta();
	}

	// innerHTML never executes <script> tags; re-create each one so tenant
	// scripts run, then mount reactive frameworks once they're done.
	function reviveTenantScripts(scriptNodes, done) {
		let index = 0;

		function appendNext() {
			if (index >= scriptNodes.length) {
				done();
				return;
			}

			const old = scriptNodes[index];
			index += 1;

			const fresh = document.createElement('script');
			for (const attr of Array.from(old.attributes)) {
				fresh.setAttribute(attr.name, attr.value);
			}
			fresh.textContent = old.textContent;
			if (old.src) {
				fresh.async = false;
				fresh.addEventListener('load', appendNext, { once: true });
				fresh.addEventListener('error', appendNext, { once: true });
			}
			ROOT.appendChild(fresh);
			if (!old.src) {
				appendNext();
			}
		}

		appendNext();
	}

	function swapHtml(command) {
		if (!ROOT) {
			return;
		}
		const html = command.html || '';
		const baseUrl = command.responseUrl || command.baseUrl || command.path || '/';
		const appBasePath = normalizeAppBasePath(command.appBasePath || state.appBasePath);

		const holder = document.createElement('div');
		holder.innerHTML = html;
		state.path = command.responseUrl || command.path || state.path || '/';
		state.appBasePath = appBasePath;
		rewriteDocumentUrls(holder, baseUrl, appBasePath);
		const scriptNodes = Array.from(holder.querySelectorAll('script'));

		ROOT.innerHTML = holder.innerHTML;
		for (const stale of Array.from(ROOT.querySelectorAll('script'))) {
			stale.remove();
		}

		reviveTenantScripts(scriptNodes, function () {
			processTenantDom(ROOT);
			updateTitleAndPath({
				title: command.title,
				path: command.path || baseUrl,
				responseUrl: command.responseUrl || baseUrl,
				appBasePath: appBasePath
			});
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
			this.responseURL = reply.responseUrl || reply.path || this.url;
			this.fuwaMeta = {
				title: reply.title,
				path: reply.path || this.responseURL,
				responseUrl: this.responseURL,
				appBasePath: reply.appBasePath || reply.baseUrl || state.appBasePath || ''
			};
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
		const xhr = event.detail?.xhr;
		const target = event.detail?.target || event.target || ROOT;
		const baseUrl = xhr?.fuwaMeta?.responseUrl || xhr?.responseURL || xhr?.fuwaMeta?.path || state.path || '/';
		const appBasePath = xhr?.fuwaMeta?.appBasePath || state.appBasePath || '';
		rewriteDocumentUrls(target, baseUrl, appBasePath);
		processTenantDom(target);
		if (xhr && xhr.fuwaMeta) {
			updateTitleAndPath(xhr.fuwaMeta);
		} else {
			updateTitleAndPath({
				path: baseUrl,
				responseUrl: baseUrl,
				appBasePath: appBasePath
			});
		}
	});

	handleClear({ type: 'clear', message: 'Run code to render.' });
	post({ type: 'ready' });
})();
