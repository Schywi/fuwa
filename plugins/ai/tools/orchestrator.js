// Orchestrator: manages the planner → fetch → analyst loop.
// Takes a user question, classifies locally, runs the tool loop,
// and returns a final answer.  Uses FuwaAITools for data and
// FuwaAIClassifier for intent.

(function () {
	'use strict';

	var MAX_ROUNDS = 3;
	var MAX_TOKENS_PER_TURN = 3000;

	var PLANNER_URL = 'https://api.deepseek.com/chat/completions';
	var PLANNER_MODEL = 'deepseek-v4-flash';

	var LOG_PREFIX = '[shell:ai-orch]';

	function log(msg, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX, msg);
		} else {
			console.info(LOG_PREFIX, msg, detail);
		}
	}

	// ── normalized fact objects ──────────────────────────────────────

	function normalizeFacts(raw_collections) {
		var facts = [];
		raw_collections.forEach(function (col) {
			if (!col || !col.items) return;
			col.items.forEach(function (item) {
				facts.push({
					type: col.type,
					source: col.source,
					content: item
				});
			});
		});
		return facts;
	}

	function formatFactsForPrompt(facts) {
		if (facts.length === 0) return '(no runtime data available)';

		var lines = [];
		facts.forEach(function (f) {
			if (f.type === 'trace_summary') {
				lines.push(f.content.method + ' ' + f.content.path + ' → ' + f.content.status + ' · ' + f.content.duration_ms + 'ms');
				if (f.content.stages && f.content.stages.length > 0) {
					lines.push('  stages: ' + f.content.stages.join(' · '));
				}
			} else if (f.type === 'terminal_error') {
				lines.push('Terminal error: ' + f.content.message);
				if (f.content.file) lines.push('  at ' + f.content.file + (f.content.line ? ':' + f.content.line : ''));
			} else if (f.type === 'terminal_output') {
				lines.push('Terminal output:\n' + f.content.text);
			} else if (f.type === 'source_excerpt') {
				lines.push('File ' + f.content.path + ' lines ' + f.content.start_line + '-' + f.content.end_line + ':\n```lua\n' + f.content.text + '\n```');
			} else if (f.type === 'db_schema') {
				lines.push('DB tables: ' + f.content.tables.map(function (t) { return t.name + ' (' + t.rows + ' rows)'; }).join(', '));
			} else if (f.type === 'db_sample') {
				lines.push('DB sample from ' + f.content.table + ':\n' + JSON.stringify(f.content.rows));
			} else if (f.type === 'modules_list') {
				lines.push('Loaded modules: ' + f.content.modules.join(', '));
			} else if (f.type === 'vfs_list') {
				lines.push('VFS files: ' + f.content.files.join(', '));
			} else if (f.type === 'active_file') {
				lines.push('Active file: ' + f.content.path);
			} else {
				lines.push(JSON.stringify(f.content).slice(0, 200));
			}
		});
		return lines.join('\n');
	}

	// ── tool execution ───────────────────────────────────────────────

	function getApiKey() {
		return window.FuwaShellAI && window.FuwaShellAI.getApiKey ? window.FuwaShellAI.getApiKey() : '';
	}

	function executeTool(name, args) {
		var tools = window.FuwaAITools;
		if (!tools) return Promise.reject(new Error('Tools not loaded'));

		var collection = null;

		switch (name) {
			case 'traces':
				collection = tools.traces ? tools.traces.collectFormatted(args && args.limit || 5) : null;
				break;
			case 'terminal':
				collection = tools.terminal ? tools.terminal.collectFormatted(args && args.lines || 30, args && args.mode || 'error_first') : null;
				break;
			case 'source_excerpt':
				if (args && args.path && tools.sources) {
					collection = tools.sources.collectExcerpt(args.path, args.start || 1, args.end || 80);
				}
				break;
			case 'active_file':
				collection = tools.sources ? tools.sources.collectActiveFile() : null;
				break;
			case 'db_schema':
				collection = tools.runtime ? tools.runtime.collectSchemaSync() : null;
				break;
			case 'db_sample':
				if (tools.runtime) {
					// This is async, but for the sync loop we use a cached version
					collection = tools.runtime.getCachedSample(args && args.table, args && args.limit || 5);
				}
				break;
			case 'modules_list':
				collection = tools.runtime ? tools.runtime.collectModulesSync() : null;
				break;
			case 'vfs_list':
				collection = tools.runtime ? tools.runtime.collectVfsSync() : null;
				break;
			default:
				return Promise.resolve(null);
		}

		return Promise.resolve(collection);
	}

	// Fetch async tools (DB queries via worker) in parallel
	async function executeAsyncTools(tool_requests) {
		var results = {};

		for (var i = 0; i < tool_requests.length; i++) {
			var req = tool_requests[i];
			if (req.tool === 'db_schema') {
				var col = await window.FuwaAITools.runtime.collectSchemaAsync();
				if (col) results.db_schema = col;
			}
			if (req.tool === 'db_sample') {
				var col2 = await window.FuwaAITools.runtime.collectSampleAsync(req.args && req.args.table, req.args && req.args.limit || 3);
				if (col2) results.db_sample = col2;
			}
			if (req.tool === 'modules_list') {
				var col3 = await window.FuwaAITools.runtime.collectModulesAsync();
				if (col3) results.modules_list = col3;
			}
			if (req.tool === 'vfs_list') {
				var col4 = await window.FuwaAITools.runtime.collectVfsAsync();
				if (col4) results.vfs_list = col4;
			}
		}

		return results;
	}

	// ── model calls ──────────────────────────────────────────────────

	function buildPlannerPrompt(question, intent, current_facts, available_tools) {
		return [
			'You are a tool-use planner for the fuwa runtime analyst.',
			'Return JSON ONLY. No commentary, no markdown.',
			'',
			'User question: ' + question,
			'Detected intent: ' + intent + ' (confidence: high)',
			'',
			'Currently available facts:',
			formatFactsForPrompt(current_facts),
			'',
			'Available tools:',
			available_tools.join(', '),
			'',
			'Return JSON with this exact schema:',
			'{',
			'  "needs_more": true or false,',
			'  "tool_requests": [',
			'    {"tool": "source_excerpt", "args": {"path": "pages/home.fuwa", "start": 1, "end": 40}}',
			'  ],',
			'  "reasoning": "one-line explanation"',
			'}',
			'',
			'Rules:',
			'- Only request tools from the available list',
			'- Prefer the smallest tool set',
			'- Never request more than 3 tools',
			'- Only request source_excerpt if you know which file and line range',
		].join('\n');
	}

	function buildAnalystPrompt(question, intent, facts) {
		return [
			'You are a runtime analyst for the fuwa web framework.',
			'Answer using ONLY the supplied facts. If evidence is insufficient, say so.',
			'Return JSON ONLY. No commentary, no markdown.',
			'',
			'User question: ' + question,
			'Detected intent: ' + intent,
			'',
			'Facts:',
			formatFactsForPrompt(facts),
			'',
			'Return JSON with this exact schema:',
			'{',
			'  "answer": "concise human-readable explanation",',
			'  "root_cause": "one-line root cause if identifiable, or null",',
			'  "evidence": ["fact 1", "fact 2"],',
			'  "confidence": 0.0-1.0,',
			'  "needs_more": true or false,',
			'  "tool_requests": []',
			'}',
			'',
			'Rules:',
			'- Use only supplied facts',
			'- Be concise (2-5 sentences)',
			'- If confidence < 0.7, set needs_more: true',
			'- Never hallucinate file paths or line numbers',
		].join('\n');
	}

	async function callModel(system_prompt, user_question) {
		var key = getApiKey();
		if (!key) throw new Error('API key not configured');

		var response = await fetch(PLANNER_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Bearer ' + key,
			},
			body: JSON.stringify({
				model: PLANNER_MODEL,
				messages: [
					{ role: 'system', content: system_prompt },
					{ role: 'user', content: user_question },
				],
				temperature: 0.1,
				max_tokens: 1024,
				response_format: { type: 'json_object' },
			}),
		});

		if (!response.ok) {
			var err = await response.text().catch(function () { return 'Unknown'; });
			throw new Error('API error ' + response.status + ': ' + err);
		}

		var data = await response.json();
		var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
		if (!content) throw new Error('Empty response from model');

		try {
			return JSON.parse(content);
		} catch (e) {
			throw new Error('Failed to parse model JSON: ' + content.slice(0, 200));
		}
	}

	// ── main loop ──────────────────────────────────────────────────────

	async function answer(question, onStatus) {
		onStatus = onStatus || function () {};
		var tools = window.FuwaAITools;
		if (!tools) throw new Error('AI tools not loaded');

		// Step 1: local classification
		var classification = window.FuwaAIClassifier.classify(question);
		log('classified', classification);

		// Step 2: auto-fetch cheap tools
		onStatus('Collecting runtime data…');
		var auto_tools = classification.auto_tools || [];
		var all_facts = [];

		for (var i = 0; i < auto_tools.length; i++) {
			var tool_name = auto_tools[i];
			var collection = await executeTool(tool_name, null);
			if (collection && collection.items) {
				all_facts.push(collection);
			}
		}

		// Step 3: planner loop (max N rounds)
		var rounds = 0;
		var done = false;
		var final_answer = null;

		while (rounds < MAX_ROUNDS && !done) {
			rounds += 1;
			log('round ' + rounds);

			var available = listAvailableTools(classification);
			var planner_prompt = buildPlannerPrompt(question, classification.intent, all_facts, available);
			var planner_result;

			try {
				planner_result = await callModel(planner_prompt, question);
			} catch (e) {
				log('planner error', e.message);
				// Fall through to analyst with whatever facts we have
				done = true;
				break;
			}

			if (!planner_result.needs_more || !planner_result.tool_requests || planner_result.tool_requests.length === 0) {
				done = true;
				break;
			}

			// Fetch requested tools
			onStatus('Fetching additional data…');
			var sync_requests = [];
			var async_requests = [];

			planner_result.tool_requests.forEach(function (req) {
				if (req.tool === 'db_schema' || req.tool === 'db_sample' || req.tool === 'modules_list' || req.tool === 'vfs_list') {
					async_requests.push(req);
				} else {
					sync_requests.push(req);
				}
			});

			// Execute sync tools
			for (var j = 0; j < sync_requests.length; j++) {
				var req = sync_requests[j];
				var col = await executeTool(req.tool, req.args);
				if (col && col.items) all_facts.push(col);
			}

			// Execute async tools in parallel
			if (async_requests.length > 0) {
				var async_results = await executeAsyncTools(async_requests);
				for (var key in async_results) {
					if (Object.prototype.hasOwnProperty.call(async_results, key)) {
						var acol = async_results[key];
						if (acol && acol.items) all_facts.push(acol);
					}
				}
			}
		}

		// Step 4: final analyst call
		onStatus('Analyzing…');
		var analyst_prompt = buildAnalystPrompt(question, classification.intent, all_facts);

		try {
			var analyst_result = await callModel(analyst_prompt, question);
			final_answer = analyst_result.answer || 'Unable to determine the answer from available data.';
			if (analyst_result.evidence && analyst_result.evidence.length > 0) {
				final_answer += '\n\nEvidence: ' + analyst_result.evidence.join('; ');
			}
			if (analyst_result.root_cause) {
				final_answer += '\n\nRoot cause: ' + analyst_result.root_cause;
			}
			return {
				answer: final_answer,
				intent: classification.intent,
				confidence: analyst_result.confidence || 0.5,
				fact_count: all_facts.length,
				rounds: rounds,
			};
		} catch (e) {
			log('analyst error', e.message);
			return {
				answer: 'Error analyzing: ' + e.message,
				intent: classification.intent,
				confidence: 0,
				fact_count: all_facts.length,
				rounds: rounds,
			};
		}
	}

	function listAvailableTools(classification) {
		var all = ['traces', 'terminal', 'source_excerpt', 'active_file', 'db_schema', 'db_sample', 'modules_list', 'vfs_list'];
		// For general intent with low confidence, limit to safe tools
		if (classification.intent === 'general' && classification.confidence < 0.5) {
			return ['traces', 'terminal', 'source_excerpt', 'active_file'];
		}
		return all;
	}

	window.FuwaAIOrchestrator = {
		answer: answer,
	};
})();
