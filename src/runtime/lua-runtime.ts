import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { LuaFactory, type LuaEngine } from 'wasmoon';

import { buildLuaRuntimeFiles, formatBuildDiagnostics, type BuildResult } from '../engine/compiler';
import { BUILTIN_LIBS, LUA_BOOT_SCRIPT } from '../engine/config';
import { resetLuaModuleCache } from '../engine/module-cache';
import type { RuntimeDefinition, RuntimeFiles } from '../engine/types';
import { loadDefaultPayload } from '../payloads';
import { VENDOR_BASE_PATH } from './vendor';
import { MemoryDatabase } from './memory-db';
import { replaceBrowserJsToken, wrapAppDocument, wrapErrorDocument } from './html-shell';

const require = createRequire(import.meta.url);

const LUA_RUNTIME_DEFINITION: RuntimeDefinition = {
	id: 'lua',
	label: 'Fuwa Gomen',
	description: 'Lean Fuwa runtime for the gomen payload.',
	language: 'lua',
	entryFile: 'app.fuwa',
	files: {},
	defaultTarget: { kind: 'script', entryFile: 'main.lua' }
};

function resolveAssetPath(candidates: readonly string[], label: string): string {
	for (const candidate of candidates) {
		try {
			return require.resolve(candidate);
		} catch {
			// Try the next candidate.
		}
	}

	throw new Error(`Unable to resolve ${label} asset. Tried: ${candidates.join(', ')}`);
}

const WASM_PATH = resolveAssetPath(['wasmoon/dist/glue.wasm'], 'wasmoon glue.wasm');

function extractPhoneTitle(fragment: string): string {
	const explicit = fragment.match(/data-phone-title="([^"]+)"/)?.[1]?.trim();
	if (explicit) return explicit;

	const heading = fragment.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
	if (heading) return heading;

	return 'Fuwa Gomen';
}

export type FuwaRuntime = {
	refresh: () => Promise<BuildResult>;
	renderRequest: (method: string, path: string, body?: string) => Promise<string>;
	getBrowserJs: () => string;
	getBuild: () => BuildResult;
	hasBuildErrors: () => boolean;
};

export async function createFuwaRuntime(): Promise<FuwaRuntime> {
	const initialPayload = loadDefaultPayload();
	let build = buildLuaRuntimeFiles(initialPayload.files, LUA_RUNTIME_DEFINITION);
	let browserJs = initialPayload.browserJs;
	let files: RuntimeFiles = build.runFiles;
	let lua: LuaEngine | null = null;
	let bootPromise: Promise<void> | null = null;
	let lastHtml = '';
	const db = new MemoryDatabase();

	async function bootLua(): Promise<void> {
		if (lua) return;
		if (bootPromise) return bootPromise;

		bootPromise = (async () => {
			const factory = new LuaFactory(WASM_PATH);
			lua = await factory.createEngine({
				openStandardLibs: true,
				functionTimeout: 2500
			});

			lua.global.set('set_html', (html: unknown) => {
				lastHtml = String(html ?? '');
			});
			lua.global.set('__fuwa_print', (...values: unknown[]) => {
				console.log('[lua]', ...values.map((value) => String(value)));
			});
			lua.global.set('__fuwa_vfs_read', (path: string) => {
				return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : BUILTIN_LIBS[path] ?? null;
			});
			lua.global.set('__fuwa_db_op', (command: unknown) => Promise.resolve(db.op(command)));

			await lua.doString(LUA_BOOT_SCRIPT);
		})()
			.catch((error) => {
				lua = null;
				throw error;
			})
			.finally(() => {
				bootPromise = null;
			});

		return bootPromise;
	}

	async function refresh(): Promise<BuildResult> {
		const payload = loadDefaultPayload();
		browserJs = payload.browserJs;
		build = buildLuaRuntimeFiles(payload.files, LUA_RUNTIME_DEFINITION);
		files = build.runFiles;

		return build;
	}

	async function renderRequest(method: string, path: string, body = ''): Promise<string> {
		if (build.diagnostics.some((entry: BuildResult['diagnostics'][number]) => entry.level === 'error')) {
			return wrapErrorDocument(
				'The Fuwa compiler could not build the payload.',
				formatBuildDiagnostics(build.diagnostics),
				{
					title: 'Fuwa build error',
					tenantBasePath: VENDOR_BASE_PATH
				}
			);
		}

		try {
			await bootLua();
			if (!lua) {
				throw new Error('Lua runtime failed to boot');
			}

			lastHtml = '';
			await resetLuaModuleCache(lua, files);

			lua.global.set('__fuwa_is_request', true);
			lua.global.set('__fuwa_method', method);
			lua.global.set('__fuwa_path', path);
			lua.global.set('__fuwa_body', body);

			await lua.doString(files['main.lua'] ?? '');
			await lua.doString(`
if type(handle_request) == "function" then
  local result = handle_request(__fuwa_method, __fuwa_path, __fuwa_body)
  if result ~= nil then
    set_html(tostring(result))
  end
end
`);

			const fragment = replaceBrowserJsToken(lastHtml || '', '/browser.js');
			return wrapAppDocument(fragment, {
				title: extractPhoneTitle(fragment),
				browserJsPath: '/browser.js',
				tenantBasePath: VENDOR_BASE_PATH,
				reloadPath: '/__dev/reload'
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details = error instanceof Error && error.stack ? error.stack : message;
			return wrapErrorDocument(message, details, {
				title: 'Fuwa runtime error',
				tenantBasePath: VENDOR_BASE_PATH
			});
		}
	}

	const runtime: FuwaRuntime = {
		refresh,
		renderRequest,
		getBrowserJs: () => browserJs,
		getBuild: () => build,
		hasBuildErrors: () =>
			build.diagnostics.some((entry: BuildResult['diagnostics'][number]) => entry.level === 'error')
	};

	await runtime.refresh();
	await bootLua();

	return runtime;
}
