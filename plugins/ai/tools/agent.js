// Agent runtime: structured state machine wrapped around the orchestrator.
// Adds persistent working memory, a critic step, skill packs, and formal
// stop rules.  The orchestrator becomes a tool executor; the agent owns the loop.
//
// State machine: new → classified → gathering → analyzing → answered (or blocked)

(function () {
	'use strict';

	var LOG_PREFIX = '[shell:ai-agent]';

	function log(msg, detail) {
		if (detail === undefined) {
			console.info(LOG_PREFIX, msg);
		} else {
			console.info(LOG_PREFIX, msg, detail);
		}
	}

	// ── skill packs ─────────────────────────────────────────────────────

	var SKILL_PACKS = {
		infra_debug: {
			label: 'Infrastructure Debug',
			tools: ['traces'],
			medium: ['terminal'],
			expensive: [],
			for_intents: ['debug_failure', 'perf_analysis', 'analyze_traces'],
		},
		runtime_debug: {
			label: 'Runtime Debug',
			tools: ['traces'],
			medium: ['terminal', 'modules_list', 'vfs_list'],
			expensive: [],
			for_intents: ['debug_failure', 'inspect_runtime'],
		},
		code_explain: {
			label: 'Code Explanation',
			tools: ['active_file'],
			medium: ['source_excerpt'],
			expensive: [],
			for_intents: ['explain_code'],
		},
		db_inspect: {
			label: 'Database Inspection',
			tools: ['db_schema'],
			medium: [],
			expensive: ['db_sample'],
			for_intents: ['inspect_database'],
		},
	};

	// Map intent to the best skill pack
	function selectSkillPack(intent) {
		for (var key in SKILL_PACKS) {
			if (!Object.prototype.hasOwnProperty.call(SKILL_PACKS, key)) continue;
			var pack = SKILL_PACKS[key];
			if (pack.for_intents.indexOf(intent) !== -1) return pack;
		}
		// Fallback: use infra_debug as the safest default
		return SKILL_PACKS.infra_debug;
	}

	// Flatten all tools available to a skill pack
	function availableTools(pack, budget) {
		var all = pack.tools.slice();
		if (budget === 'medium' || budget === 'expensive') {
			all = all.concat(pack.medium);
		}
		if (budget === 'expensive') {
			all = all.concat(pack.expensive);
		}
		return all;
	}

	// ── state machine ────────────────────────────────────────────────────

	function createState(question, intent) {
		return {
			task_id: 't-' + Date.now(),
			user_goal: question,
			intent: intent.intent,
			confidence: intent.confidence,
			status: 'classified',   // new | classified | gathering | analyzing | answered | blocked
			phase: 'init',
			hypotheses: [],
			facts: [],              // {id, source, type, content, timestamp}
			tool_history: [],       // {tool, args, outcome, duration_ms, timestamp}
			skill_pack: selectSkillPack(intent.intent),
			tool_budget: 'cheap',   // cheap | medium | expensive (escalates per round)
			constraints: {
				read_only: true,
				max_steps: 4,
				max_tokens: 8000,
				enough_confidence: 0.75,
				min_evidence: 2,
				max_stale_steps: 2,
			},
			started_at: Date.now(),
			final_answer: null,
		};
	}

	function transition(state, new_status, detail) {
		var prev = state.status;
		state.status = new_status;
		state.phase = detail || new_status;
		log('state: ' + prev + ' → ' + new_status, detail ? detail : '');
	}

	// ── fact ingestion ──────────────────────────────────────────────────

	var _fact_counter = 0;

	function ingestFacts(state, collections) {
		if (!collections || collections.length === 0) return 0;
		var count = 0;
		collections.forEach(function (col) {
			if (!col || !col.items) return;
			col.items.forEach(function (item) {
				_fact_counter += 1;
				state.facts.push({
					id: 'f' + _fact_counter,
					source: col.source,
					type: col.type,
					content: item,
					timestamp: new Date().toISOString(),
				});
				count += 1;
			});
		});
		return count;
	}

	function factSummary(state) {
		// Group by type and return a compact summary
		var by_type = {};
		state.facts.forEach(function (f) {
			by_type[f.type] = (by_type[f.type] || 0) + 1;
		});
		var parts = [];
		for (var key in by_type) {
			if (Object.prototype.hasOwnProperty.call(by_type, key)) {
				parts.push(key + ': ' + by_type[key]);
			}
		}
		return parts.join(', ') || '(no facts)';
	}

	// ── critic ───────────────────────────────────────────────────────────

	function criticStep(state, before_fact_count) {
		var after_count = state.facts.length;
		var new_facts = after_count - before_fact_count;

		// Did we learn anything?
		var progressed = new_facts > 0;

		// Count stale steps (consecutive steps with no new facts)
		if (!progressed) {
			state._stale_steps = (state._stale_steps || 0) + 1;
		} else {
			state._stale_steps = 0;
		}

		// Check stop conditions
		var evidence_count = state.facts.length;
		var steps = state.tool_history.length;

		// Rule 1: high confidence + enough evidence
		if (state.confidence >= state.constraints.enough_confidence && evidence_count >= state.constraints.min_evidence) {
			log('critic: stop — high confidence (' + state.confidence + ') + evidence (' + evidence_count + ')');
			return { progress: true, new_facts: new_facts, should_continue: false, reason: 'enough_evidence' };
		}

		// Rule 2: max steps reached
		if (steps >= state.constraints.max_steps) {
			log('critic: stop — max steps (' + state.constraints.max_steps + ')');
			return { progress: progressed, new_facts: new_facts, should_continue: false, reason: 'max_steps' };
		}

		// Rule 3: stale — no new facts for too many steps
		if (state._stale_steps >= state.constraints.max_stale_steps) {
			log('critic: stop — stale (' + state._stale_steps + ' steps with no new facts)');
			return { progress: false, new_facts: 0, should_continue: false, reason: 'stale' };
		}

		// Escalate tool budget if we're making progress but not enough
		if (progressed && state.tool_budget === 'cheap' && evidence_count < state.constraints.min_evidence) {
			state.tool_budget = 'medium';
			log('critic: escalate tool budget → medium');
		} else if (progressed && state.tool_budget === 'medium' && evidence_count < state.constraints.min_evidence && steps >= 2) {
			state.tool_budget = 'expensive';
			log('critic: escalate tool budget → expensive');
		}

		return { progress: progressed, new_facts: new_facts, should_continue: true, reason: 'continue' };
	}

	// ── model calls ──────────────────────────────────────────────────────

	async function callModel(system_prompt, user_message) {
		if (!(window.FuwaAIProviderCompat && window.FuwaAIProviderCompat.callJsonModel)) {
			throw new Error('Provider compatibility layer not loaded');
		}

		return window.FuwaAIProviderCompat.callJsonModel([
			{ role: 'system', content: system_prompt },
			{ role: 'user', content: user_message },
		], {
			temperature: 0.1,
			max_tokens: 1024,
		});
	}

	// ── tool execution ───────────────────────────────────────────────────

	function executeTool(name, args) {
		var tools = window.FuwaAITools;
		if (!tools) return Promise.resolve(null);

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
				collection = tools.runtime ? tools.runtime.getCachedSample(args && args.table, args && args.limit || 3) : null;
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

	// ── prompt builders ──────────────────────────────────────────────────

	function formatFactsForPrompt(facts) {
		if (!facts || facts.length === 0) return '(no facts yet)';
		var lines = [];
		facts.forEach(function (f) {
			var c = f.content;
			if (f.type === 'trace_summary') {
				lines.push('- [' + f.source + '] ' + c.method + ' ' + c.path + ' → ' + c.status + ' · ' + c.duration_ms + 'ms');
			} else if (f.type === 'terminal_error') {
				lines.push('- [' + f.source + '] ERROR: ' + c.message + (c.file ? ' at ' + c.file + ':' + c.line : ''));
			} else if (f.type === 'terminal_output') {
				lines.push('- [' + f.source + '] ' + c.text.slice(0, 300).replace(/\n/g, ' '));
			} else if (f.type === 'source_excerpt') {
				lines.push('- [' + f.source + '] ' + c.path + ' L' + c.start_line + '-' + c.end_line + ' (' + c.total_lines + ' total)');
			} else if (f.type === 'db_schema') {
				var tbls = c.tables.map(function (t) { return t.name + ':' + t.rows; });
				lines.push('- [' + f.source + '] DB tables: ' + tbls.join(', '));
			} else if (f.type === 'db_sample') {
				lines.push('- [' + f.source + '] ' + c.table + ' sample (' + c.rows.length + ' rows)');
			} else if (f.type === 'modules_list') {
				lines.push('- [' + f.source + '] Loaded modules: ' + c.modules.join(', '));
			} else if (f.type === 'vfs_list') {
				lines.push('- [' + f.source + '] VFS: ' + c.files.join(', '));
			} else if (f.type === 'active_file') {
				lines.push('- [' + f.source + '] Active file: ' + c.path + ' (' + c.line_count + ' lines)');
			} else {
				lines.push('- [' + f.source + '] ' + JSON.stringify(c).slice(0, 200));
			}
		});
		return lines.join('\n');
	}

	function buildPlannerPrompt(state) {
		var pack = state.skill_pack;
		var tools = availableTools(pack, state.tool_budget);

		return [
			'You are a tool-use planner for a fuwa runtime debug agent.',
			'Return JSON ONLY.',
			'',
			'CURRENT STATE:',
			'  Intent: ' + state.intent,
			'  Skill pack: ' + pack.label,
			'  Tool budget: ' + state.tool_budget,
			'  Steps taken: ' + state.tool_history.length + ' / ' + state.constraints.max_steps,
			'  Facts collected: ' + state.facts.length,
			'  Confidence: ' + state.confidence.toFixed(2),
			'',
			'ALREADY COLLECTED FACTS:',
			formatFactsForPrompt(state.facts),
			'',
			'TOOLS USED SO FAR: ' + state.tool_history.map(function (h) { return h.tool; }).join(', ') || '(none)',
			'',
			'AVAILABLE TOOLS (' + state.tool_budget + ' budget): ' + tools.join(', '),
			'',
			'USER QUESTION: ' + state.user_goal,
			'',
			'Return JSON:',
			'{',
			'  "needs_more": true or false,',
			'  "tool_requests": [{"tool": "...", "args": {...}}],',
			'  "reasoning": "one-line explanation",',
			'  "hypothesis": "what you suspect is happening (optional)"',
			'}',
			'',
			'Rules:',
			'- Only request tools from the available list',
			'- Do NOT request a tool already used unless you have a good reason',
			'- Prefer the smallest tool set needed',
			'- Max 3 tool requests per call',
		].join('\n');
	}

	function buildAnalystPrompt(state) {
		return [
			'You are a runtime analyst for the fuwa web framework.',
			'Answer using ONLY the supplied facts. Return JSON ONLY.',
			'',
			'USER QUESTION: ' + state.user_goal,
			'INTENT: ' + state.intent,
			'SKILL: ' + state.skill_pack.label,
			'STEPS: ' + state.tool_history.length + ', FACTS: ' + state.facts.length,
			'',
			'FACTS:',
			formatFactsForPrompt(state.facts),
			'',
			'Return JSON:',
			'{',
			'  "answer": "concise human-readable explanation (2-5 sentences)",',
			'  "root_cause": "one-line root cause or null",',
			'  "evidence": ["fact summary 1", "fact summary 2"],',
			'  "confidence": 0.0-1.0,',
			'  "next_steps": ["suggestion 1", "suggestion 2"]',
			'}',
			'',
			'Rules:',
			'- Use only supplied facts. Never hallucinate.',
			'- If evidence is thin, say so in the answer.',
			'- Be specific: mention file names, line numbers, status codes.',
		].join('\n');
	}

	// ── main agent loop ──────────────────────────────────────────────────

	async function investigate(question, onStatus) {
		onStatus = onStatus || function () {};

		// Step 1: classify
		onStatus('Classifying…');
		var classification = window.FuwaAIClassifier.classify(question);
		var state = createState(question, classification);
		log('classified: ' + state.intent + ' → skill ' + state.skill_pack.label);

		// Step 2: auto-fetch cheap tools
		transition(state, 'gathering', 'auto-fetch');
		onStatus('Collecting runtime data…');

		var auto_tools = classification.auto_tools || [];
		for (var i = 0; i < auto_tools.length; i++) {
			var col = await executeTool(auto_tools[i], null);
			if (col && col.items && col.items.length > 0) {
				ingestFacts(state, [col]);
				state.tool_history.push({ tool: auto_tools[i], args: null, outcome: 'success', duration_ms: 0, timestamp: new Date().toISOString() });
			}
		}
		log('auto-fetch: ' + state.facts.length + ' facts from ' + auto_tools.join(', ') || '(none)');

		// Step 3: planner loop
		var rounds = 0;
		var answered = false;

		while (rounds < state.constraints.max_steps && !answered) {
			rounds += 1;
			transition(state, 'analyzing', 'planner round ' + rounds + '/' + state.constraints.max_steps);
			onStatus('Thinking (round ' + rounds + '/' + state.constraints.max_steps + ')...');

			var before_count = state.facts.length;

			// 3a: ask planner what to do next
			var planner_result;
			try {
				var planner_prompt = buildPlannerPrompt(state);
				planner_result = await callModel(planner_prompt, question);
			} catch (e) {
				log('planner error', e.message);
				// Fall through — try to answer with what we have
				answered = true;
				break;
			}

			// Update hypothesis if provided
			if (planner_result.hypothesis) {
				state.hypotheses.push({
					id: 'h' + state.hypotheses.length,
					text: planner_result.hypothesis,
					confidence: 0.3,
					status: 'active',
				});
			}

			// 3b: if planner says we have enough, stop looping
			if (!planner_result.needs_more || !planner_result.tool_requests || planner_result.tool_requests.length === 0) {
				log('planner: enough data, stopping loop');
				answered = true;
				break;
			}

			// 3c: execute requested tools
			transition(state, 'gathering', 'tool execution');
			onStatus('Fetching: ' + planner_result.tool_requests.map(function (r) { return r.tool; }).join(', '));

			var sync_reqs = [];
			var async_reqs = [];

			planner_result.tool_requests.forEach(function (req) {
				if (['db_schema', 'db_sample', 'modules_list', 'vfs_list'].indexOf(req.tool) !== -1) {
					async_reqs.push(req);
				} else {
					sync_reqs.push(req);
				}
			});

			var start_time = Date.now();

			// Run sync tools
			for (var j = 0; j < sync_reqs.length; j++) {
				var req = sync_reqs[j];
				var col = await executeTool(req.tool, req.args);
				if (col && col.items && col.items.length > 0) {
					ingestFacts(state, [col]);
				}
				state.tool_history.push({ tool: req.tool, args: req.args, outcome: col ? 'success' : 'empty', duration_ms: Date.now() - start_time, timestamp: new Date().toISOString() });
			}

			// Run async tools in parallel
			if (async_reqs.length > 0) {
				var async_cols = await executeAsyncTools(async_reqs);
				for (var key in async_cols) {
					if (Object.prototype.hasOwnProperty.call(async_cols, key)) {
						var acol = async_cols[key];
						if (acol && acol.items && acol.items.length > 0) {
							ingestFacts(state, [acol]);
						}
					}
				}
				async_reqs.forEach(function (req) {
					state.tool_history.push({ tool: req.tool, args: req.args, outcome: 'success', duration_ms: Date.now() - start_time, timestamp: new Date().toISOString() });
				});
			}

			// 3d: critic — should we continue?
			var critic = criticStep(state, before_count);
			state.confidence = Math.min(1.0, state.confidence + (critic.new_facts > 0 ? 0.05 : -0.02));
			log('critic: ' + critic.reason + ' (facts: ' + before_count + '→' + state.facts.length + ', stale: ' + (state._stale_steps || 0) + ', confidence: ' + state.confidence.toFixed(2) + ')');

			if (!critic.should_continue) {
				answered = true;
				break;
			}
		}

		// Step 4: final analyst call
		transition(state, 'analyzing', 'final analysis');
		onStatus('Synthesizing answer…');

		var analyst_prompt = buildAnalystPrompt(state);
		var result;

		try {
			result = await callModel(analyst_prompt, question);
		} catch (e) {
			log('analyst error', e.message);
			result = {
				answer: 'Unable to determine the root cause from available data.',
				root_cause: null,
				evidence: [],
				confidence: 0.1,
				next_steps: [],
			};
		}

		// Save confidence from analyst
		if (typeof result.confidence === 'number') {
			state.confidence = result.confidence;
		}

		state.final_answer = result;
		transition(state, 'answered', 'done');

		var elapsed = ((Date.now() - state.started_at) / 1000).toFixed(1);

		// Build the final answer string
		var answer = result.answer || 'No answer produced.';
		if (result.evidence && result.evidence.length > 0) {
			answer += '\n\nEvidence: ' + result.evidence.join(' · ');
		}
		if (result.root_cause) {
			answer += '\n\nRoot cause: ' + result.root_cause;
		}
		if (result.next_steps && result.next_steps.length > 0) {
			answer += '\n\nNext steps: ' + result.next_steps.join('; ');
		}

		// Metadata footer
		answer += '\n\n[' + state.intent + ' · ' + state.skill_pack.label.toLowerCase() +
			' · ' + state.facts.length + ' facts from ' + factSummary(state) +
			' · ' + rounds + ' rounds · ' + elapsed + 's · conf ' + state.confidence.toFixed(2) + ']';

		return {
			answer: answer,
			state: state,
		};
	}

	window.FuwaAIAgent = {
		investigate: investigate,
		// Expose these for debugging
		SKILL_PACKS: SKILL_PACKS,
		createState: createState,
	};
})();
