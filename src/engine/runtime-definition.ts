import type { RuntimeDefinition } from './types';
import {
	FUWA_GOMEN_ENTRY_FILE,
	FUWA_GOMEN_VISIBLE_FILES,
	buildFuwaGomenFiles
} from '../payloads/fuwa-gomen/index';

export const RUNTIME_DEFINITIONS: RuntimeDefinition[] = [
	{
		id: 'lua',
		label: 'Fuwa Gomen',
		description: 'Fuwa DSL version of Mama Gomen with an in-memory build step.',
		language: 'lua',
		entryFile: FUWA_GOMEN_ENTRY_FILE,
		defaultTarget: { kind: 'script', entryFile: 'main.lua' },
		files: buildFuwaGomenFiles(),
		visibleFiles: [...FUWA_GOMEN_VISIBLE_FILES]
	}
];

export const RUNTIME_DEFINITION_BY_ID = Object.fromEntries(
	RUNTIME_DEFINITIONS.map((runtime) => [runtime.id, runtime])
) as Record<(typeof RUNTIME_DEFINITIONS)[number]['id'], RuntimeDefinition>;

export function cloneRuntimeFiles(id: RuntimeDefinition['id']) {
	return buildFuwaGomenFiles();
}
