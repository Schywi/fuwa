// Behavioural check for the CPU|GPU toggle: the click decides which assistant
// answers, and every answer is labelled with the backend that produced it.
// Run from the repo root: node tests/js/assistant_backend.mjs

import assert from 'node:assert/strict';
import { loadShell, settle } from './harness.mjs';

function answered(html = '<div class="msg bot">ok<div class="meta"><span class="tag">1.0s</span></div></div>') {
	return { ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(html) };
}

// ── 1. the default answers from the CPU assistant ───────────────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push(url);
				return Promise.resolve(answered());
			}
		}
	});

	assert.equal(shell.state.assistantBackend, 'cpu', 'cpu is the default');
	shell.state.assistantInput = 'hello';
	shell.state.sendAssistant();
	await settle();

	assert.deepEqual(calls, ['/assistant/ui/message'], 'cpu goes through /assistant/');
	const turn = shell.thread.children[shell.thread.children.length - 1];
	assert.equal(turn.className, 'assistant-turn', 'the answer is wrapped in a turn');
	assert.equal(turn.getAttribute('data-backend'), 'cpu', 'and labelled cpu');
}

// ── 2. switching to GPU moves every call, not just the chat ─────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push(url);
				return Promise.resolve(answered());
			}
		}
	});

	shell.state.setAssistantBackend('gpu');
	assert.equal(shell.state.assistantBackend, 'gpu', 'the toggle takes effect');

	shell.state.assistantInput = 'hello';
	shell.state.sendAssistant();
	await settle();
	assert.equal(calls.pop(), '/assistant-gpu/ui/message', 'chat follows the toggle');

	const turn = shell.thread.children[shell.thread.children.length - 1];
	assert.equal(turn.getAttribute('data-backend'), 'gpu', 'the turn is labelled gpu');

	shell.state.toggleAssistantMetrics();
	await settle();
	assert.equal(calls.pop(), '/assistant-gpu/metrics', 'metrics follow the toggle');

	shell.state.toggleAssistantActions();
	await settle();
	assert.equal(calls.pop(), '/assistant-gpu/actions', 'actions follow the toggle');

	shell.state.assistantInput = 'x';
	shell.state.previewAssistantPlan();
	await settle();
	assert.equal(calls.pop(), '/assistant-gpu/plan?kind=qwen', 'the planner follows the toggle');
}

// ── 3. switching back, and both answers coexist in the thread ──────────
{
	const shell = loadShell({ window: { fetch: () => Promise.resolve(answered()) } });

	shell.state.assistantInput = 'first';
	shell.state.sendAssistant();
	await settle();

	shell.state.setAssistantBackend('gpu');
	shell.state.assistantInput = 'second';
	shell.state.sendAssistant();
	await settle();

	const turns = shell.thread.children.filter((node) => node.className === 'assistant-turn');
	assert.equal(turns.length, 2, 'two answers');
	assert.equal(turns[0].getAttribute('data-backend'), 'cpu', 'the earlier one keeps cpu colouring');
	assert.equal(turns[1].getAttribute('data-backend'), 'gpu', 'the later one is gpu');

	shell.state.setAssistantBackend('cpu');
	assert.equal(shell.state.assistantBackend, 'cpu', 'the toggle is reversible');
}

// ── 4. an unknown value falls back to cpu, never to nothing ────────────
{
	const shell = loadShell();
	shell.state.setAssistantBackend('tpu');
	assert.equal(shell.state.assistantBackend, 'cpu', 'unknown backends resolve to cpu');

	const proxy = shell.window.FuwaShellWorkspace.assistantProxyUrl;
	assert.equal(proxy('/audio/a'), '/assistant/audio/a', 'assets follow the active base');
	shell.state.setAssistantBackend('gpu');
	assert.equal(proxy('/audio/a'), '/assistant-gpu/audio/a', 'and move with the toggle');
	assert.equal(proxy('/assistant-gpu/audio/a'), '/assistant-gpu/audio/a', 'never prefixed twice');
	assert.equal(proxy('/assistant/audio/a'), '/assistant/audio/a', 'an older prefix is left alone');
}

// ── 5. the switch is logged, and stale health/metrics are dropped ──────
{
	const shell = loadShell();
	shell.state.assistantOnline = true;
	shell.state.assistantMetrics = { stages: [], tools: [], rejected: 0 };
	shell.state.setAssistantBackend('gpu');

	assert.equal(shell.state.assistantOnline, null, 'health of the other backend is unknown again');
	assert.equal(shell.state.assistantMetrics, null, 'its metrics panel closes');
	assert.ok(shell.logs.some((line) => line.includes('assistant:backend')), 'the switch is logged');
}

console.log('assistant backend ok: CPU|GPU toggle routes and labels every turn');
