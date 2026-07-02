(function () {
	'use strict';

	const ROOT = document.getElementById('app');
	const payloadUrl = document.body?.dataset?.payloadUrl || document.baseURI;

	function escapeHtml(value) {
		return String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;');
	}

	function loadDocument(source, responseUrl) {
		const trimmed = String(source || '').trim();
		if (trimmed === '') {
			return { html: '', title: undefined };
		}

		const parser = new DOMParser();
		const parsed = parser.parseFromString(trimmed, 'text/html');
		const title = parsed.querySelector('title')?.textContent?.trim() || undefined;
		const bodyClone = parsed.body.cloneNode(true);
		for (const script of Array.from(bodyClone.querySelectorAll('script'))) {
			script.remove();
		}
		const headAssets = [
			...Array.from(parsed.head.querySelectorAll('style')).map((node) => node.outerHTML),
			...Array.from(parsed.head.querySelectorAll('link[rel="stylesheet"]')).map((node) => node.outerHTML)
		].join('');
		const bodyHtml = bodyClone.innerHTML.trim();
		const scriptNodes = Array.from(parsed.querySelectorAll('script'));
		return {
			html: `${headAssets}${bodyHtml}`,
			scriptNodes,
			title,
			path: responseUrl
		};
	}

	function reviveScripts(scriptNodes, done) {
		let pending = 0;
		let finished = false;
		const maybeDone = () => {
			if (finished || pending > 0) return;
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
				const settle = () => {
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

	function processTenantDom(scope) {
		if (window.PetiteVue && typeof window.PetiteVue.createApp === 'function' && scope instanceof Element) {
			try {
				window.PetiteVue.createApp().mount(scope);
			} catch (error) {
				console.error('[tenant] petite-vue mount failed', error);
			}
		}

		if (window.htmx && window.htmx.config) {
			window.htmx.config.allowScriptTags = false;
		}

		if (window.htmx && typeof window.htmx.process === 'function' && scope instanceof Element) {
			window.htmx.process(scope);
		}
	}

	async function boot() {
		if (!ROOT) return;

		try {
			const response = await fetch(payloadUrl, { credentials: 'same-origin' });
			const html = await response.text();
			const rendered = loadDocument(html, response.url || payloadUrl);
			ROOT.innerHTML = rendered.html || `<div class="shell-bootstrap-error">Unable to load ${escapeHtml(payloadUrl)}</div>`;
			if (rendered.title) {
				document.title = rendered.title;
			}

			const scriptNodes = rendered.scriptNodes || [];
			reviveScripts(scriptNodes, () => {
				processTenantDom(ROOT);
			});
		} catch (error) {
			ROOT.innerHTML = `<div class="shell-bootstrap-error">Failed to boot payload: ${escapeHtml(error?.message || error)}</div>`;
			console.error('[tenant] bootstrap failed', error);
		}
	}

	boot();
})();
