import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLuaRuntimeFiles } from '../src/engine/compiler';
import { RUNTIME_DEFINITIONS } from '../src/engine/runtime-definition';
import { buildFuwaGomenFiles } from '../src/payloads/fuwa-gomen';

test('fuwa-gomen compiles into main and view modules', () => {
	const result = buildLuaRuntimeFiles(buildFuwaGomenFiles(), RUNTIME_DEFINITIONS[0]);

	assert.equal(result.diagnostics.length, 0);
	assert.ok(result.runFiles['main.lua']);
	assert.ok(result.runFiles['view.lua']);
	assert.equal(result.manifest.kind, 'fuwa');
});
