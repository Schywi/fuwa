// Behavioural check for level-2 actions: GET /actions (catalog + enabled),
// POST /actions/request (token + preview), POST /actions/confirm (execute).
// Nothing may execute without the explicit confirm click.
// Run from the repo root: node tests/js/assistant_actions.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadShell } from './harness.mjs';

const catalog = fs.readFileSync(new URL('../fixtures/assistant_actions.json', import.meta.url), 'utf8');
const requested = JSON.parse(fs.readFileSync(new URL('../fixtures/assistant_action_request.json', import.meta.url), 'utf8'));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── 1. the catalog loads, disabled state included ─────────────────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push({ url });
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(catalog)) });
			}
		}
	});

	assert.equal(shell.state.assistantActions, null, 'panel starts closed');
	shell.state.toggleAssistantActions();
	await tick();

	assert.deepEqual(calls.map((call) => call.url), ['/assistant/actions'], 'catalog comes from the proxied route');
	assert.equal(shell.state.assistantActions.enabled, false, 'the upstream reports actions disabled');
	assert.deepEqual(
		Array.from(shell.state.assistantActions.catalog, (entry) => entry.name),
		['restart_deployment', 'scale_deployment'],
		'the catalog is preserved'
	);

	// Disabled upstream → refuse before minting anything.
	calls.length = 0;
	shell.state.requestAssistantAction('restart_deployment');
	await tick();
	assert.equal(calls.length, 0, 'no token is minted while actions are disabled');
	assert.ok(
		shell.toasts.text().includes('Actions are disabled on the assistant'),
		'the refusal explains itself'
	);
}

// ── 2. enabled: prepare mints a token + preview, and does NOT execute ────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url, options) => {
				calls.push({ url, method: (options && options.method) || 'GET', body: options && options.body });
				if (url === '/assistant/actions') {
					return Promise.resolve({
						ok: true,
						status: 200,
						json: () => Promise.resolve({ enabled: true, catalog: JSON.parse(catalog).catalog, pending: [] })
					});
				}
				if (url === '/assistant/actions/request') {
					return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(requested) });
				}
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ restarted: true }) });
			}
		}
	});

	shell.state.toggleAssistantActions();
	await tick();

	shell.state.assistantActionArgs = { restart_deployment: '{"namespace":"default","name":"demo"}' };
	shell.state.requestAssistantAction('restart_deployment');
	await tick();

	const prepare = calls[calls.length - 1];
	assert.equal(prepare.url, '/assistant/actions/request', 'prepare hits the request route');
	assert.equal(prepare.method, 'POST', 'prepare is a POST');
	assert.deepEqual(JSON.parse(prepare.body), { tool: 'restart_deployment', args: { namespace: 'default', name: 'demo' } });
	assert.equal(shell.state.assistantActionPreview.token, requested.token, 'the token is held for confirmation');
	assert.equal(shell.state.assistantActionPreview.preview.target, 'default/demo', 'the preview is shown');
	assert.ok(
		!calls.some((call) => call.url === '/assistant/actions/confirm'),
		'preparing must never execute the action'
	);

	// Confirm is the only path that executes.
	shell.state.confirmAssistantAction();
	await tick();
	const confirm = calls[calls.length - 1];
	assert.equal(confirm.url, '/assistant/actions/confirm', 'confirm hits the confirm route');
	assert.deepEqual(JSON.parse(confirm.body), { token: requested.token }, 'the minted token is what executes');
	assert.equal(shell.state.assistantActionPreview, null, 'the preview clears once executed');
	assert.ok(shell.state.assistantActionResult.startsWith('executed: '), 'the result is reported');
	assert.ok(shell.logs.some((line) => line.includes('assistant:action-confirmed')), 'the execution is logged');
}

// ── 3. bad args are refused before any request ───────────────────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push({ url });
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.resolve({ enabled: true, catalog: [], pending: [] })
				});
			}
		}
	});
	shell.state.toggleAssistantActions();
	await tick();
	calls.length = 0;

	shell.state.assistantActionArgs = { restart_deployment: 'not json' };
	shell.state.requestAssistantAction('restart_deployment');
	await tick();

	assert.equal(calls.length, 0, 'invalid JSON never reaches the assistant');
	assert.ok(shell.toasts.text().includes('args must be JSON'), 'the argument error is surfaced');
}

// ── 4. failures are reported, not swallowed ──────────────────────────────
{
	const shell = loadShell({
		window: {
			fetch: (url) => {
				if (url === '/assistant/actions') {
					return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true, catalog: [], pending: [] }) });
				}
				if (url === '/assistant/actions/request') {
					return Promise.resolve({
						ok: false,
						status: 400,
						json: () => Promise.resolve({ detail: "unknown action 'nope'; try restart_deployment, scale_deployment" })
					});
				}
				return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'unknown or expired token' }) });
			}
		}
	});

	shell.state.toggleAssistantActions();
	await tick();
	shell.state.requestAssistantAction('nope');
	await tick();
	assert.ok(
		shell.toasts.text().includes("unknown action 'nope'"),
		"the assistant's detail message is used, not a bare status code"
	);
	assert.equal(shell.state.assistantActionPreview, null, 'no preview from a failed prepare');

	// Confirming without a preview is refused locally.
	shell.state.confirmAssistantAction();
	await tick();
	assert.ok(shell.toasts.text().includes('Nothing to confirm'), 'confirm without a token is refused');

	// A failing confirm lands in the result line.
	shell.state.assistantActionPreview = { token: 'expired', action: 'restart_deployment' };
	shell.state.confirmAssistantAction();
	await tick();
	assert.equal(shell.state.assistantActionResult, 'failed: unknown or expired token', 'the failure is visible');
}

// ── 5. an unreachable catalog is a diagnostic ─────────────────────────────
{
	const shell = loadShell({ window: { fetch: () => Promise.resolve({ ok: false, status: 502 }) } });
	shell.state.toggleAssistantActions();
	await tick();
	assert.equal(shell.state.assistantActions, null, 'no panel without a catalog');
	assert.equal(shell.state.assistantActionsError, 'actions unavailable: HTTP 502', 'the status is named');
	assert.ok(shell.logs.some((line) => line.includes('assistant:actions-failed')), 'the failure is logged');
}

console.log('assistant actions ok: catalog, prepare preview, explicit confirm, loud failures');
