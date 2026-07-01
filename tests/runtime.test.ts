import assert from 'node:assert/strict';
import test from 'node:test';

import { createFuwaRuntime } from '../src/runtime/lua-runtime';

test('fuwa runtime renders the gomen payload and preserves DB state', async () => {
	const runtime = await createFuwaRuntime();

	const home = await runtime.renderRequest('GET', '/');
	assert.match(home, /data-balance="1000"/);
	assert.match(home, /data-spent="0"/);
	assert.match(home, /data-pokes="0"/);
	assert.match(home, /script id="fuwa-ide-gsap" src="\/vendor\/gsap\.min\.js"/);
	assert.match(home, /script defer src="\/vendor\/petite-vue\.js" init/);
	assert.match(home, /window\.__FUWA_IDE_TENANT_BASE__ = "\/vendor"/);
	assert.match(home, /\/browser\.js/);

	const afterPoke = await runtime.renderRequest('GET', '/poke');
	assert.match(afterPoke, /data-pokes="1"/);
	assert.match(afterPoke, /data-balance="1000"/);

	const afterPurchase = await runtime.renderRequest('GET', '/buy/onigiri');
	assert.match(afterPurchase, /data-balance="950"/);
	assert.match(afterPurchase, /data-spent="50"/);
});
