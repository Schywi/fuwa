// Behavioural check for the planner debug panel: POST /plan?kind=qwen|laya
// answers {planner, plan_ms, tools[]} without running anything.
// Run from the repo root: node tests/js/assistant_plan.mjs

import assert from 'node:assert/strict';
import { loadShell } from './harness.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const planPayload = {
	planner: 'bundle:unhealthy',
	plan_ms: 0.0,
	tools: [
		{ tool: 'get_pods', args: {} },
		{ tool: 'get_events', args: {} },
		{ tool: 'query_prometheus', args: { query: 'sum(rate(hubble_drop_total[5m])) by (reason)' } }
	]
};

// ── 1. the panel plans the composer text through the proxy ───────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url, options) => {
				calls.push({ url, method: (options && options.method) || 'GET', body: options && options.body });
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(planPayload) });
			}
		}
	});

	shell.state.assistantInput = 'which pods are failing?';
	shell.state.toggleAssistantPlan();
	await tick();

	assert.equal(calls.length, 1, 'one planner call');
	assert.equal(calls[0].url, '/assistant/plan?kind=qwen', 'defaults to qwen through the proxy');
	assert.equal(calls[0].method, 'POST', 'the plan route is a POST');
	assert.deepEqual(JSON.parse(calls[0].body), { message: 'which pods are failing?' }, 'the composer text is planned');

	assert.equal(shell.state.assistantPlan.planner, 'bundle:unhealthy', 'the planner label is surfaced, even when unhealthy');
	assert.equal(shell.state.assistantPlan.plan_ms, 0, 'the plan latency is shown');
	assert.deepEqual(
		Array.from(shell.state.assistantPlan.tools, (entry) => entry.tool),
		['get_pods', 'get_events', 'query_prometheus'],
		'every planned tool is listed'
	);
	assert.equal(
		shell.state.assistantPlan.tools[2].args_text,
		'{"query":"sum(rate(hubble_drop_total[5m])) by (reason)"}',
		'tool args are pre-rendered as text for the template'
	);
	assert.ok(shell.logs.some((line) => line.includes('assistant:plan')), 'the plan is logged');

	// Closing the panel does not re-plan.
	calls.length = 0;
	shell.state.toggleAssistantPlan();
	await tick();
	assert.equal(shell.state.assistantPlan, null, 'a second click closes the panel');
	assert.equal(calls.length, 0, 'closing must not re-plan');
}

// ── 2. the kind switch hits laya ─────────────────────────────────────────
{
	const urls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				urls.push(url);
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ planner: 'laya-fallback:unhealthy', plan_ms: 0, tools: [] }) });
			}
		}
	});
	shell.state.assistantInput = 'anything';
	shell.state.assistantPlanKind = 'laya';
	shell.state.previewAssistantPlan();
	await tick();

	assert.deepEqual(urls, ['/assistant/plan?kind=laya'], 'the selected planner backend is used');
	assert.equal(shell.state.assistantPlan.planner, 'laya-fallback:unhealthy', 'the fallback label is visible');
}

// ── 3. planning nothing is refused locally ───────────────────────────────
{
	const calls = [];
	const shell = loadShell({
		window: {
			fetch: (url) => {
				calls.push(url);
				return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(planPayload) });
			}
		}
	});
	shell.state.assistantInput = '   ';
	shell.state.toggleAssistantPlan();
	await tick();

	assert.equal(calls.length, 0, 'an empty message never reaches the planner');
	assert.ok(shell.toasts.text().includes('Type a question first'), 'the refusal explains itself');
}

// ── 4. a failing planner is a diagnostic ─────────────────────────────────
{
	const shell = loadShell({
		window: {
			fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ detail: 'planner model unavailable' }) })
		}
	});
	shell.state.assistantInput = 'anything';
	shell.state.toggleAssistantPlan();
	await tick();

	assert.equal(shell.state.assistantPlan, null, 'no panel without a plan');
	assert.equal(shell.state.assistantPlanError, 'planner unavailable: planner model unavailable', "the assistant's detail is used");
	assert.ok(shell.logs.some((line) => line.includes('assistant:plan-failed')), 'the failure is logged');
}

console.log('assistant plan ok: qwen/laya, tool args, no run, loud failures');
