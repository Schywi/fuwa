import { GSAP_ROUTE, PETITE_VUE_ROUTE, VENDOR_BASE_PATH } from './vendor';

function escapeHtml(value: string): string {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function normalizePath(value: string): string {
	const trimmed = String(value ?? '').trim();
	if (!trimmed || trimmed === '/') return '/';
	return trimmed.replace(/\/+$/, '');
}

export function replaceBrowserJsToken(html: string, browserJsPath = '/browser.js'): string {
	if (!html.includes('__BROWSER_JS__')) return html;
	return html.replace(/__BROWSER_JS__/g, browserJsPath);
}

export function buildDevReloadScript(reloadPath = '/__dev/reload'): string {
	const path = JSON.stringify(reloadPath);
	return [
		'<script>',
		'(() => {',
		'  try {',
		`    const source = new EventSource(${path});`,
		'    source.onmessage = () => location.reload();',
		'    source.onerror = () => {',
		'      // EventSource reconnects automatically; keep the connection open.',
		'    };',
		'  } catch (error) {',
		'    console.error("[fuwa] live reload bootstrap failed", error);',
		'  }',
		'})();',
		'</script>'
	].join('\n');
}

export type AppDocumentOptions = {
	title?: string;
	browserJsPath?: string;
	tenantBasePath?: string;
	reloadPath?: string | null;
};

export function wrapAppDocument(fragment: string, options: AppDocumentOptions = {}): string {
	const tenantBasePath = normalizePath(options.tenantBasePath ?? VENDOR_BASE_PATH);
	const browserJsPath = options.browserJsPath ?? '/browser.js';
	const reloadPath = options.reloadPath === undefined ? '/__dev/reload' : options.reloadPath;
	const title = escapeHtml(options.title ?? 'Fuwa Gomen');
	const bodyHtml = replaceBrowserJsToken(fragment, browserJsPath);
	const reloadScript = reloadPath !== null ? `\n${buildDevReloadScript(reloadPath)}` : '';

	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'  <meta charset="utf-8">',
		'  <meta name="viewport" content="width=device-width, initial-scale=1">',
		`  <title>${title}</title>`,
		'  <script>',
		`    window.__FUWA_IDE_TENANT_BASE__ = ${JSON.stringify(tenantBasePath)};`,
		'  </script>',
		`  <script id="fuwa-ide-gsap" src="${GSAP_ROUTE}"></script>`,
		`  <script defer src="${PETITE_VUE_ROUTE}" init></script>`,
		'</head>',
		'<body style="margin:0;min-height:100vh;">',
		bodyHtml,
		`${reloadScript}`,
		'</body>',
		'</html>'
	].join('\n');
}

export function wrapErrorDocument(message: string, details: string, options: AppDocumentOptions = {}): string {
	const body = [
		'<main class="phone-screen phone-screen-scroll" data-phone-title="Fuwa Gomen">',
		'  <section class="phone-section phone-safe-all">',
		'    <div class="phone-stack" style="padding:24px;">',
		'      <h1>Fuwa build error</h1>',
		`      <p>${escapeHtml(message)}</p>`,
		`      <pre style="white-space:pre-wrap;line-height:1.5;overflow:auto;">${escapeHtml(details)}</pre>`,
		'    </div>',
		'  </section>',
		'</main>'
	].join('\n');

	return wrapAppDocument(body, options);
}
