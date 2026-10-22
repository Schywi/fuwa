// Behavioural check for the drawer's session control: rotate the id the
// assistant threads conversations under, and clear the transcript.
// Run from the repo root: node tests/js/assistant_session.mjs

import assert from 'node:assert/strict';
import { loadShell } from './harness.mjs';

const SESSION_KEY = 'fuwa-assistant-session';

// ── 1. a fresh session rotates the id, persists it and clears the thread ───
{
	const shell = loadShell();
	const before = shell.state.assistantSession;
	assert.match(before, /^fuwa-/, 'the drawer starts with a session id');

	shell.thread.appendChild({ textContent: 'an old answer' });
	shell.state.assistantMetrics = { stages: [], tools: [], rejected: 0 };
	shell.state.assistantMetricsError = 'stale error';
	assert.equal(shell.thread.children.length, 1, 'thread starts with content');

	shell.state.newAssistantSession();

	assert.notEqual(shell.state.assistantSession, before, 'the session id must change');
	assert.match(shell.state.assistantSession, /^fuwa-/, 'the new id keeps the shell prefix');
	assert.equal(
		shell.window.localStorage.store.get(SESSION_KEY),
		shell.state.assistantSession,
		'the new id is persisted so a reload continues the same conversation'
	);
	assert.equal(shell.thread.children.length, 0, 'the transcript is cleared');
	assert.equal(shell.state.assistantMetrics, null, 'the metrics panel closes');
	assert.equal(shell.state.assistantMetricsError, '', 'panel errors are cleared');
	assert.ok(shell.toasts.text().includes('New session'), 'the rotation is acknowledged');
	assert.ok(shell.logs.some((line) => line.includes('assistant:new-session')), 'the rotation is logged');
}

// ── 2. rotating mid-request is refused instead of mixing two sessions ─────
{
	const shell = loadShell();
	const before = shell.state.assistantSession;
	shell.thread.appendChild({ textContent: 'an answer in flight' });
	shell.state.assistantBusy = true;

	shell.state.newAssistantSession();

	assert.equal(shell.state.assistantSession, before, 'the session must not rotate mid-request');
	assert.equal(shell.thread.children.length, 1, 'the thread is left alone');
	assert.ok(
		shell.toasts.text().includes('Wait for the current answer first'),
		'the refusal explains itself'
	);
}

// ── 3. the next send uses the rotated id ─────────────────────────────────
{
	const requests = [];
	const shell = loadShell({
		window: {
			fetch: (url, options) => {
				requests.push({ url, body: options && options.body });
				return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<div class="msg bot">ok</div>') });
			}
		}
	});

	shell.state.newAssistantSession();
	const session = shell.state.assistantSession;
	shell.state.assistantInput = 'hello';
	shell.state.sendAssistant();
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(requests.length, 1, 'one request went out');
	assert.equal(requests[0].url, '/assistant/ui/message', 'through the proxy');
	assert.equal(requests[0].body.get('session'), session, 'the rotated id is what the assistant sees');
}

console.log('assistant session ok: rotate, persist, clear, refuse mid-request');
