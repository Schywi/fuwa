import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPayloadFiles } from '../src/payloads';

test('fuwa-gomen browser bundle loads gsap from the tenant base', () => {
	const payload = buildPayloadFiles('fuwa-gomen');

	assert.match(payload.browserJs, /const gsapScriptId = 'fuwa-ide-gsap'/);
	assert.match(payload.browserJs, /window\.__FUWA_IDE_TENANT_BASE__/);
	assert.match(payload.browserJs, /\$\{tenantBase\}\/gsap\.min\.js/);
});
