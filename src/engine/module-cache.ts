import type { LuaEngine } from 'wasmoon';
import type { RuntimeFiles } from './types';

function escapeLuaString(value: string): string {
	return `"${value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(/\f/g, '\\f')
		.replace(/\u0008/g, '\\b')}"`;
}

export function luaModuleNameFromFileName(fileName: string): string | null {
	if (!fileName.endsWith('.lua')) return null;

	const modulePath = fileName.slice(0, -'.lua'.length).replace(/\/+/g, '/').trim();
	if (modulePath === '') return null;

	return modulePath.split('/').join('.');
}

export function collectLuaModuleNames(files: RuntimeFiles): string[] {
	return Object.keys(files)
		.map(luaModuleNameFromFileName)
		.filter((name): name is string => name !== null)
		.sort();
}

export function buildLuaModuleCacheResetScript(files: RuntimeFiles): string {
	const moduleNames = collectLuaModuleNames(files);
	if (moduleNames.length === 0) return '';

	return [
		'for _, moduleName in ipairs({',
		...moduleNames.map((name) => `  ${escapeLuaString(name)},`),
		'}) do',
		'  package.loaded[moduleName] = nil',
		'end'
	].join('\n');
}

export async function resetLuaModuleCache(lua: LuaEngine, files: RuntimeFiles): Promise<void> {
	const script = buildLuaModuleCacheResetScript(files);
	if (!script) return;
	await lua.doString(script);
}
