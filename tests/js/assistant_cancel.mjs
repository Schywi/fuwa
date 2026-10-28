// Behavioural check for cancelling a question in flight. The assistant has no
// cancel route, so this stops waiting on the shell side only — which the UI
// must say out loud rather than pretend the work was called off.
// Run from the repo root: node tests/js/assistant_cancel.mjs

import assert from 'node:assert/strict';
import { loadShell, settle } from './harness.mjs';

class FakeAbortController {
	constructor() {
		this.signal = { aborted: false };
		FakeAbortController.last = this;
	}
	abort() {
		this.signal.aborted = true;
		if (this.onabort) this.onabort();
	}
}

// ── 1. cancelling rejects the request and marks the turn cancelled ───────
{
	const shell = loadShell({
		window: {
			AbortController: FakeAbortController,
			fetch: (url, options) => {
				const signal = options.signal;
				return new Promise((resolve, reject) => {
					const controller = FakeAbortController.last;
					controller.onabort = () => {
						const error = new Error('aborted');
						error.name = 'AbortError';
						reject(error);
					};
					if (signal && signal.aborted) controller.onabort();
				});
			}
		}
	});

	shell.state.assistantInput = 'a long investigate question';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.state.assistantBusy, true, 'the turn is in flight');
	assert.ok(FakeAbortController.last.signal, 'a controller was created for the request');

	shell.state.cancelAssistantQuestion();
	await settle();

	assert.equal(shell.state.assistantBusy, false, 'cancelling frees the composer');
	assert.ok(shell.logs.some((line) => line.includes('assistant:cancelled')), 'the cancellation is logged');
	assert.ok(
		shell.toasts.text().includes('the assistant may still finish server-side'),
		'the toast states the server keeps working'
	);
	assert.equal(shell.thread.children.length, 2, 'question + cancelled marker');
	assert.equal(shell.thread.children[1].textContent, 'cancelled', 'the pending bubble becomes a marker');
	assert.ok(
		!shell.toasts.text().includes('Request failed'),
		'a cancellation is not reported as a failure'
	);
}

// ── 2. the cancelled marker survives a view swap ─────────────────────────
{
	const shell = loadShell({
		window: {
			AbortController: FakeAbortController,
			fetch: (url, options) =>
				new Promise((resolve, reject) => {
					FakeAbortController.last.onabort = () => {
						const error = new Error('aborted');
						error.name = 'AbortError';
						reject(error);
					};
				})
		}
	});
	shell.state.assistantInput = 'question';
	shell.state.sendAssistant();
	await settle();
	shell.state.cancelAssistantQuestion();
	await settle();

	shell.thread.replaceChildren();
	shell.fire('htmx:afterSwap', { detail: { target: shell.node() }, target: shell.node() });

	assert.equal(shell.thread.children.length, 2, 'question + cancelled marker are replayed');
	assert.equal(shell.thread.children[1].textContent, 'cancelled', 'the cancellation is part of the transcript');
}

// ── 3. cancelling with nothing in flight is a no-op ─────────────────────
{
	const shell = loadShell();
	shell.state.cancelAssistantQuestion();
	assert.equal(shell.toasts.text(), '', 'nothing to cancel, nothing said');
	assert.equal(shell.state.assistantBusy, false, 'state untouched');
}

console.log('assistant cancel ok: stop waiting, say so, keep it in the transcript');
