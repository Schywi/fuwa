// Behavioural check for the drawer's metrics panel: GET /assistant/metrics is
// Prometheus text, reduced to the few numbers worth showing.
// Run from the repo root: node tests/js/assistant_metrics.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadShell } from './harness.mjs';

const fixture = fs.readFileSync(new URL('../fixtures/assistant_metrics.txt', import.meta.url), 'utf8');

// ── 1. the parser ─────────────────────────────────────────────────────────
{
	const shell = loadShell();
	const summary = shell.window.FuwaShellWorkspace.parseAssistantMetrics(fixture);

	// Arrays come from the vm realm, so copy them into this one before comparing.
	assert.deepEqual(
		Array.from(summary.stages, (entry) => entry.stage),
		['chat', 'correlate', 'plan'],
		'stages should be the labelled LLM stages, sorted'
	);

	const plan = summary.stages.find((entry) => entry.stage === 'plan');
	assert.equal(plan.requests, 12, 'plan request count comes from assistant_llm_requests_total');
	assert.equal(plan.avg_ms, 4129, 'plan average is sum/count in ms (49.5449 s / 12)');
	assert.equal(plan.input_tokens, 3240, 'prompt tokens');
	assert.equal(plan.output_tokens, 132, 'generated tokens');

	const chat = summary.stages.find((entry) => entry.stage === 'chat');
	assert.equal(chat.ttft_ms, 3012, 'ttft average is sum/count in ms (24.0945 s / 8)');
	assert.equal(plan.ttft_ms, null, 'a stage without ttft samples reports null, not 0');

	assert.deepEqual(
		Array.from(summary.tools, (entry) => ({ ...entry })),
		[{ tool: 'get_pods', calls: 6, avg_ms: 562 }],
		'tool latency should be averaged per tool'
	);
	assert.equal(summary.rejected, 0, 'concurrency rejections are surfaced');
}

// ── 2. non-assistant metrics are ignored ──────────────────────────────────
{
	const shell = loadShell();
	const summary = shell.window.FuwaShellWorkspace.parseAssistantMetrics(fixture);
	assert.equal(summary.stages.length, 3, 'python_/process_ families must not become rows');
	assert.ok(
		!summary.stages.some((entry) => entry.stage === 'unknown'),
		'labels are parsed, not defaulted to unknown'
	);

	const empty = shell.window.FuwaShellWorkspace.parseAssistantMetrics('');
	assert.deepEqual(
		{ stages: Array.from(empty.stages), tools: Array.from(empty.tools), rejected: empty.rejected },
		{ stages: [], tools: [], rejected: 0 },
		'garbage in, empty summary out'
	);
}

// ── 3. the toggle fetches once and closes again ───────────────────────────
{
	const requests = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				requests.push(url);
				return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fixture) });
			}
		}
	});

	assert.equal(shell.state.assistantMetrics, null, 'panel starts closed');
	shell.state.toggleAssistantMetrics();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(requests, ['/assistant/metrics'], 'metrics come from the proxied route');
	assert.equal(shell.state.assistantMetrics.stages.length, 3, 'panel receives the parsed summary');

	shell.state.toggleAssistantMetrics();
	assert.equal(shell.state.assistantMetrics, null, 'a second click closes the panel');
	assert.equal(requests.length, 1, 'closing must not refetch');
}

// ── 4. a failed fetch is a diagnostic, not a blank panel ──────────────────
{
	const shell = loadShell({
		window: { fetch: () => Promise.resolve({ ok: false, status: 503 }) }
	});
	shell.state.toggleAssistantMetrics();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(shell.state.assistantMetrics, null, 'no panel without data');
	assert.equal(shell.state.assistantMetricsError, 'metrics unavailable: HTTP 503', 'the status is reported');
	assert.ok(shell.logs.some((line) => line.includes('assistant:metrics-failed')), 'the failure is logged');
}

console.log('assistant metrics ok: parse, filter, toggle, loud failure');
