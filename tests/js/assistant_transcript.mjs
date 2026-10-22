// Behavioural check for transcript survival: htmx replaces the whole view on
// navigation, which wipes the drawer's DOM. The conversation must come back.
// Run from the repo root: node tests/js/assistant_transcript.mjs

import assert from 'node:assert/strict';
import { loadShell, settle } from './harness.mjs';

function shellWithAnswers(answers) {
	const queue = answers.slice();
	return loadShell({
		window: {
			fetch: (url) => {
				const next = queue.shift();
				return Promise.resolve(
					next || { ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('') }
				);
			}
		}
	});
}

const answered = (html) => ({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(html) });
const failed = () => ({ ok: false, status: 500, headers: { get: () => null }, text: () => Promise.resolve('') });

function swap(shell) {
	// What htmx does: the subtree is replaced, so the drawer starts empty.
	shell.thread.replaceChildren();
	shell.fire('htmx:afterSwap', { detail: { target: shell.node() }, target: shell.node() });
}

// ── 1. the question comes back after a view swap ─────────────────────────
{
	const shell = shellWithAnswers([answered('<div class="msg bot">answer</div>')]);
	shell.state.assistantInput = 'why are pods failing?';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.thread.children.length, 1, 'the question is on screen');

	swap(shell);

	assert.equal(shell.thread.children.length, 1, 'the question is replayed');
	assert.equal(shell.thread.children[0].textContent, 'why are pods failing?', 'with the same text');
	assert.ok(shell.logs.some((line) => line.includes('assistant:thread-restored')), 'the restore is logged');
}

// ── 2. errors are part of the transcript and survive too ────────────────
{
	const shell = shellWithAnswers([failed()]);
	shell.state.assistantInput = 'anything';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.thread.children.length, 2, 'question + error bubble');

	swap(shell);

	assert.equal(shell.thread.children.length, 2, 'both entries come back');
	assert.equal(shell.thread.children[0].textContent, 'anything', 'the question first');
	assert.equal(shell.thread.children[1].className, 'msg bot err', 'the error keeps its styling');
	assert.ok(
		shell.thread.children[1].textContent.startsWith('Request failed:'),
		'the error keeps its text'
	);
}

// ── 3. a live transcript is never clobbered ─────────────────────────────
{
	const shell = shellWithAnswers([answered('<div class="msg bot">first</div>')]);
	shell.state.assistantInput = 'first question';
	shell.state.sendAssistant();
	await settle();

	// A swap that did not destroy the drawer (e.g. a different view region).
	shell.fire('htmx:afterSwap', { detail: { target: shell.node() }, target: shell.node() });
	assert.equal(shell.thread.children.length, 1, 'nothing is duplicated into a live thread');
}

// ── 4. a new session drops the buffer ───────────────────────────────────
{
	const shell = shellWithAnswers([answered('<div class="msg bot">answer</div>')]);
	shell.state.assistantInput = 'old question';
	shell.state.sendAssistant();
	await settle();

	shell.state.newAssistantSession();
	swap(shell);

	assert.equal(shell.thread.children.length, 0, 'a fresh session does not resurrect the old transcript');
}

// ── 5. an empty buffer restores nothing ─────────────────────────────────
{
	const shell = shellWithAnswers([]);
	swap(shell);
	assert.equal(shell.thread.children.length, 0, 'no transcript, nothing to restore');
	assert.equal(shell.logs.some((line) => line.includes('assistant:thread-restored')), false, 'and no log noise');
}

console.log('assistant transcript ok: survives swaps, errors included, session reset wins');
