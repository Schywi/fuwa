// Behavioural check for the drawer's liveness probe: opening the drawer asks
// /assistant/healthz, and an unreachable assistant disables the composer
// instead of letting the user type into a dead socket.
// Run from the repo root: node tests/js/assistant_health.mjs

import assert from 'node:assert/strict';
import { loadShell, settle } from './harness.mjs';

// ── 1. a healthy assistant is reported ───────────────────────────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push(url);
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok' }) });
			}
		}
	});

	assert.equal(shell.state.assistantOnline, null, 'unknown until probed');
	shell.state.openDrawer();
	await settle();

	assert.equal(shell.state.drawerOpen, true, 'the drawer still opens');
	assert.deepEqual(calls, ['/assistant/healthz'], 'the probe goes through the proxy');
	assert.equal(shell.state.assistantOnline, true, 'a 200 marks the assistant online');
	assert.ok(shell.logs.some((line) => line.includes('assistant:health-ok')), 'the probe result is logged');
}

// ── 2. an unreachable assistant is reported, not assumed ────────────────
{
	const shell = loadShell({
		window: { fetch: () => Promise.resolve({ ok: false, status: 502 }) }
	});
	shell.state.openDrawer();
	await settle();

	assert.equal(shell.state.assistantOnline, false, 'a failing probe marks it offline');
	assert.ok(shell.logs.some((line) => line.includes('assistant:health-failed')), 'the failure is logged');
}

// ── 3. a network error is treated the same as a bad status ───────────────
{
	const shell = loadShell({
		window: { fetch: () => Promise.reject(new Error('network down')) }
	});
	shell.state.openDrawer();
	await settle();

	assert.equal(shell.state.assistantOnline, false, 'a rejected fetch means offline');
	assert.ok(
		shell.logs.some((line) => line.includes('network down')),
		'the underlying reason is logged'
	);
}

// ── 4. every open re-probes, so recovery is noticed ──────────────────────
{
	let healthy = false;
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push(url);
				return healthy
					? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok' }) })
					: Promise.resolve({ ok: false, status: 503 });
			}
		}
	});

	shell.state.openDrawer();
	await settle();
	assert.equal(shell.state.assistantOnline, false, 'first probe: down');

	shell.state.closeDrawer();
	healthy = true;
	shell.state.openDrawer();
	await settle();

	assert.equal(calls.length, 2, 'each open probes once');
	assert.equal(shell.state.assistantOnline, true, 'recovery is picked up on the next open');
}

// ── 5. a delivered answer also proves liveness ───────────────────────────
{
	const shell = loadShell({
		window: {
			fetch: (url) => {
				if (url === '/assistant/healthz') {
					return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok' }) });
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: { get: () => null },
					text: () => Promise.resolve('<div class="msg bot">ok</div>')
				});
			}
		}
	});

	shell.state.assistantOnline = false;
	shell.state.assistantInput = 'hello';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.state.assistantOnline, true, 'a successful answer flips the state back to online');
}

console.log('assistant health ok: probe on open, offline surfaced, recovery noticed');
