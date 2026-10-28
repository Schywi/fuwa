// Behavioural check for 429 backpressure: the assistant's limiter answers
// 429 + Retry-After when it is saturated. The drawer must honour the delay,
// retry once, and never lose the question.
// Run from the repo root: node tests/js/assistant_backpressure.mjs

import assert from 'node:assert/strict';
import { loadShell, settle, fakeScheduler } from './harness.mjs';

function busy(retryAfter = '2') {
	return {
		ok: false,
		status: 429,
		headers: { get: () => retryAfter },
		text: () => Promise.resolve(''),
		json: () => Promise.resolve({ detail: 'busy' })
	};
}

function answered(body = '<div class="msg bot">ok</div>') {
	return { ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(body) };
}

// ── 1. one retry after the advertised delay ───────────────────────────────
{
	const scheduler = fakeScheduler();
	const responses = [busy('2'), answered()];
	const calls = [];
	const shell = loadShell({
		window: {
			...scheduler.window,
			fetch: (url, options) => {
				calls.push({ url, body: options && options.body });
				return Promise.resolve(responses.shift());
			}
		}
	});

	shell.state.assistantInput = 'why are pods failing?';
	shell.state.sendAssistant();
	await settle();

	assert.equal(calls.length, 1, 'the first attempt goes out immediately');
	assert.equal(calls[0].url, '/assistant/ui/message', 'through the proxy');
	assert.equal(shell.state.assistantRetryIn, 2, 'Retry-After drives the countdown');
	assert.equal(shell.state.assistantBusy, true, 'the composer stays busy while waiting');
	assert.equal(shell.state.assistantOnline, null, 'a 429 says nothing about health');

	// The countdown ticks down without sending anything.
	scheduler.tickIntervals();
	assert.equal(shell.state.assistantRetryIn, 1, 'the countdown decrements');
	assert.equal(calls.length, 1, 'the countdown never sends');

	// After the delay the same question is retried exactly once.
	scheduler.runTimeouts();
	await settle();
	assert.equal(calls.length, 2, 'exactly one retry');
	assert.equal(calls[1].body.get('message'), 'why are pods failing?', 'the same question is retried');
	assert.equal(shell.state.assistantRetryIn, 0, 'the countdown clears');
	assert.equal(shell.state.assistantBusy, false, 'the composer is usable again');
	assert.equal(shell.state.assistantOnline, true, 'a delivered answer proves the assistant is up');
	assert.ok(!shell.toasts.text().includes('still busy'), 'a successful retry is not reported as failure');
}

// ── 2. a second 429 gives the question back instead of looping ────────────
{
	const scheduler = fakeScheduler();
	const responses = [busy('1'), busy('1')];
	const calls = [];
	const shell = loadShell({
		window: {
			...scheduler.window,
			fetch: (url, options) => {
				calls.push({ url, body: options && options.body });
				return Promise.resolve(responses.shift());
			}
		}
	});

	shell.state.assistantInput = 'why are pods failing?';
	shell.state.sendAssistant();
	await settle();
	scheduler.runTimeouts();
	await settle();
	scheduler.runTimeouts();
	await settle();

	assert.equal(calls.length, 2, 'only one retry is attempted');
	assert.equal(shell.state.assistantInput, 'why are pods failing?', 'the question is restored to the composer');
	assert.equal(shell.state.assistantBusy, false, 'the composer unlocks');
	assert.equal(shell.state.assistantRetryIn, 0, 'no countdown is left running');
	assert.ok(
		shell.toasts.text().includes('Assistant still busy (429) — question restored'),
		'the user is told what happened'
	);
	assert.ok(shell.logs.some((line) => line.includes('assistant:busy')), 'the backpressure is logged');
}

// ── 3. a missing or nonsense Retry-After falls back to 5 s ────────────────
{
	const scheduler = fakeScheduler();
	const shell = loadShell({
		window: {
			...scheduler.window,
			fetch: () => Promise.resolve({ ...busy('soon'), status: 429 })
		}
	});
	shell.state.assistantInput = 'anything';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.state.assistantRetryIn, 5, 'an unusable Retry-After defaults to 5 s');
}

// ── 4. a response with no headers object at all still works ───────────────
{
	const scheduler = fakeScheduler();
	const shell = loadShell({
		window: {
			...scheduler.window,
			fetch: () => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('') })
		}
	});
	shell.state.assistantInput = 'anything';
	shell.state.sendAssistant();
	await settle();
	assert.equal(shell.state.assistantRetryIn, 5, 'no headers means the default wait, not a crash');
}

console.log('assistant backpressure ok: honour Retry-After, retry once, restore the question');
