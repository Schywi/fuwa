// Behavioural check for the drawer's voice input: MediaRecorder → multipart
// POST /assistant/voice/transcribe, with the 501 (no STT configured) path
// reported instead of swallowed.
// Run from the repo root: node tests/js/assistant_voice.mjs

import assert from 'node:assert/strict';
import { loadShell, settle } from './harness.mjs';

const uploads = [];

class FakeRecorder {
	constructor(stream) {
		this.stream = stream;
		this.mimeType = 'audio/webm';
		this.handlers = {};
		FakeRecorder.last = this;
	}
	addEventListener(type, fn) {
		this.handlers[type] = fn;
	}
	start() {
		this.started = true;
	}
	stop() {
		this.handlers.dataavailable({ data: new Blob(['chunk']) });
		this.handlers.stop();
	}
}

function streamStub() {
	const tracks = [];
	for (let i = 0; i < 1; i += 1) {
		tracks.push({ stopped: false, stop() { this.stopped = true; } });
	}
	return { tracks, getTracks: () => tracks };
}

function respondWith({ status, json }) {
	return () => {
		uploads.push(status);
		return Promise.resolve({
			ok: status >= 200 && status < 300,
			status,
			json: () => Promise.resolve(json),
			text: () => Promise.resolve('')
		});
	};
}

// ── 1. happy path: record, stop, transcribe, fill the composer ─────────────
let stream = streamStub();
{
	const shell = loadShell({
		window: {
			MediaRecorder: FakeRecorder,
			Blob,
			FormData,
			fetch: respondWith({ status: 200, json: { text: 'which pods are not ready?' } })
		},
		navigator: { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } }
	});

	shell.state.toggleAssistantRecording();
	await settle();
	assert.equal(shell.state.assistantRecording, true, 'recording state should be on');
	assert.equal(FakeRecorder.last.started, true, 'the recorder should be started');

	FakeRecorder.last.stop();
	await settle();
	assert.equal(shell.state.assistantRecording, false, 'recording state should clear on stop');
	assert.equal(stream.tracks[0].stopped, true, 'the microphone track must be released');
	assert.equal(shell.state.assistantInput, 'which pods are not ready?', 'transcript should land in the composer');
	assert.deepEqual(uploads, [200], 'one upload was attempted');
	assert.ok(shell.toasts.text().includes('Transcript ready'), 'success should toast');
}

// ── 2. 501 (no STT_URL upstream) is a loud diagnostic ─────────────────────
{
	uploads.length = 0;
	stream = streamStub();
	const shell = loadShell({
		window: {
			MediaRecorder: FakeRecorder,
			Blob,
			FormData,
			fetch: respondWith({ status: 501, json: {} })
		},
		navigator: { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } }
	});

	shell.state.assistantInput = 'typed text';
	shell.state.toggleAssistantRecording();
	await settle();
	FakeRecorder.last.stop();
	await settle();

	assert.equal(shell.state.assistantInput, 'typed text', 'a failed transcript must not clobber the composer');
	assert.ok(
		shell.toasts.text().includes('STT not configured on the assistant (501)'),
		'the 501 must name the missing STT configuration'
	);
	assert.ok(
		shell.logs.some((line) => line.includes('assistant:transcribe-failed')),
		'the failure must be logged'
	);
}

// ── 3. permission refusal is reported, not silent ─────────────────────────
{
	const shell = loadShell({
		window: { MediaRecorder: FakeRecorder, Blob, FormData },
		navigator: {
			mediaDevices: { getUserMedia: () => Promise.reject(new Error('Permission denied')) }
		}
	});

	shell.state.toggleAssistantRecording();
	await settle();
	assert.equal(shell.state.assistantRecording, false, 'no recording without a stream');
	assert.ok(shell.toasts.text().includes('Microphone unavailable: Permission denied'), 'the refusal must show');
	assert.ok(shell.logs.some((line) => line.includes('assistant:mic-failed')), 'the refusal must be logged');
}

// ── 4. a browser without MediaRecorder gets told so ───────────────────────
{
	const shell = loadShell({ navigator: { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } } });
	shell.state.toggleAssistantRecording();
	await settle();
	assert.ok(
		shell.toasts.text().includes('Recording is not available in this browser'),
		'unsupported browsers must be told, not ignored'
	);
}

console.log('assistant voice ok: record → transcribe → composer, 501 loud, refusals surfaced');
