import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import chokidar from 'chokidar';

import { createFuwaRuntime } from './runtime/lua-runtime';
import { GSAP_ROUTE, PETITE_VUE_ROUTE, readVendorAsset } from './runtime/vendor';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

function sendText(response: ServerResponse, statusCode: number, contentType: string, body: string): void {
	response.writeHead(statusCode, {
		'Content-Type': `${contentType}; charset=utf-8`,
		'Cache-Control': 'no-store'
	});
	response.end(body);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => {
			chunks.push(chunk);
		});
		request.on('end', () => {
			resolve(Buffer.concat(chunks).toString('utf8'));
		});
		request.on('error', reject);
	});
}

function normalizePathname(url: URL): string {
	return url.pathname.replace(/\/+$/, '') || '/';
}

function createReloadHub() {
	const clients = new Set<ServerResponse>();

	return {
		subscribe(request: IncomingMessage, response: ServerResponse): void {
			response.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no'
			});
			response.write('retry: 1000\n\n');
			clients.add(response);

			request.on('close', () => {
				clients.delete(response);
			});
		},
		broadcast(message = 'reload'): void {
			for (const response of clients) {
				response.write(`data: ${message}\n\n`);
			}
		}
	};
}

async function main(): Promise<void> {
	const runtime = await createFuwaRuntime();
	const reloadHub = createReloadHub();

	const watcher = chokidar.watch(['src/engine/**/*', 'src/payloads/fuwa-gomen/**/*'], {
		ignoreInitial: true
	});

	let refreshQueue: Promise<void> = Promise.resolve();

	const queueRefresh = (reason: string) => {
		refreshQueue = refreshQueue
			.then(async () => {
				const build = await runtime.refresh();
				const mode = build.diagnostics.some((entry: { level: string }) => entry.level === 'error')
					? 'with errors'
					: 'ok';
				console.log(`[dev] refreshed ${reason} (${mode})`);
				reloadHub.broadcast();
			})
			.catch((error) => {
				console.error(`[dev] refresh failed for ${reason}`, error);
			});
	};

	watcher.on('all', (event, changedPath) => {
		console.log(`[dev] ${event} ${changedPath}`);
		queueRefresh(changedPath);
	});

	const server = createServer(async (request, response) => {
		const method = request.method ?? 'GET';
		const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
		const pathname = normalizePathname(url);

		if (method === 'GET' && pathname === '/__dev/reload') {
			reloadHub.subscribe(request, response);
			return;
		}

		if (method === 'GET' && pathname === '/browser.js') {
			sendText(response, 200, 'application/javascript', runtime.getBrowserJs());
			return;
		}

		if (method === 'GET' && (pathname === GSAP_ROUTE || pathname === PETITE_VUE_ROUTE)) {
			const asset = readVendorAsset(pathname);
			if (!asset) {
				sendText(response, 404, 'text/plain', 'Not found');
				return;
			}
			sendText(response, 200, asset.contentType, asset.body);
			return;
		}

		const body = method === 'GET' || method === 'HEAD' ? '' : await readRequestBody(request);
		const html = await runtime.renderRequest(method, `${url.pathname}${url.search}`, body);
		sendText(response, 200, 'text/html', html);
	});

	server.listen(PORT, HOST, () => {
		console.log(`[dev] fuwa server listening at http://${HOST}:${PORT}`);
	});
}

void main().catch((error) => {
	console.error('[dev] fatal', error);
	process.exitCode = 1;
});
