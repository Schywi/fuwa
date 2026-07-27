// Local intent classifier. Runs BEFORE any LLM call.
// Deterministic, zero-latency, maps user questions to intents and tool sets.
// If confidence is low, falls through to the LLM planner.

(function () {
	'use strict';

	window.FuwaAIClassifier = {
		// Returns { intent, confidence, auto_tools, reason }
		classify: function (question) {
			var lower = (question || '').toLowerCase();

			// ── Rule 1: debug failure ─────────────────────────────────
			if (hasAny(lower, ['error', 'crash', 'fail', '500', '4', 'broken', 'bug', 'wrong', 'not working', 'issue', 'exception', 'stack trace'])) {
				return {
					intent: 'debug_failure',
					confidence: 0.95,
					auto_tools: ['traces', 'terminal'],
					tool_hints: ['source_excerpt'],
					reason: 'error/crash keywords detected'
				};
			}

			// ── Rule 2: explain code ──────────────────────────────────
			if (hasAny(lower, ['explain', 'what does', 'how does', 'what is this', 'understand', 'describe', 'tell me about', 'walk through'])) {
				// Check if a specific file is mentioned
				var filePath = extractFilePath(lower);
				return {
					intent: 'explain_code',
					confidence: filePath ? 0.90 : 0.70,
					auto_tools: ['active_file'],
					tool_hints: filePath ? ['source_excerpt'] : [],
					reason: 'explanation keywords detected' + (filePath ? ', file: ' + filePath : '')
				};
			}

			// ── Rule 3: database inspection ───────────────────────────
			if (hasAny(lower, ['database', 'schema', 'table', 'row', 'column', 'sql', 'db', 'query', 'data', 'record', 'collection'])) {
				return {
					intent: 'inspect_database',
					confidence: 0.88,
					auto_tools: ['db_schema'],
					tool_hints: ['db_sample'],
					reason: 'database keywords detected'
				};
			}

			// ── Rule 4: performance analysis ─────────────────────────
			if (hasAny(lower, ['slow', 'latency', 'fast', 'speed', 'performance', 'timing', 'ms', 'duration', 'timeout'])) {
				return {
					intent: 'perf_analysis',
					confidence: 0.85,
					auto_tools: ['traces'],
					tool_hints: [],
					reason: 'performance/latency keywords detected'
				};
			}

			// ── Rule 5: runtime inspection ────────────────────────────
			if (hasAny(lower, ['module', 'loaded', 'vfs', 'package', 'memory', 'require'])) {
				return {
					intent: 'inspect_runtime',
					confidence: 0.88,
					auto_tools: ['modules_list'],
					tool_hints: [],
					reason: 'runtime/module keywords detected'
				};
			}

			// ── Rule 6: trace analysis ────────────────────────────────
			if (hasAny(lower, ['trace', 'request', 'route', 'endpoint', 'handler', 'http'])) {
				return {
					intent: 'analyze_traces',
					confidence: 0.82,
					auto_tools: ['traces'],
					tool_hints: [],
					reason: 'trace/request keywords detected'
				};
			}

			// ── Rule 7: explicit tool commands ────────────────────────
			if (lower.indexOf('/db') !== -1 || lower.indexOf('/schema') !== -1) {
				return {
					intent: 'inspect_database',
					confidence: 1.0,
					auto_tools: ['db_schema', 'db_sample'],
					tool_hints: [],
					reason: 'explicit /db or /schema command'
				};
			}
			if (lower.indexOf('/modules') !== -1 || lower.indexOf('/vfs') !== -1) {
				return {
					intent: 'inspect_runtime',
					confidence: 1.0,
					auto_tools: ['modules_list', 'vfs_list'],
					tool_hints: [],
					reason: 'explicit /modules or /vfs command'
				};
			}
			if (lower.indexOf('/term') !== -1) {
				return {
					intent: 'debug_failure',
					confidence: 0.90,
					auto_tools: ['terminal'],
					tool_hints: ['source_excerpt'],
					reason: 'explicit /term command'
				};
			}
			if (lower.indexOf('/trace') !== -1) {
				return {
					intent: 'analyze_traces',
					confidence: 1.0,
					auto_tools: ['traces'],
					tool_hints: [],
					reason: 'explicit /trace command'
				};
			}

			// ── Fallback: general question ────────────────────────────
			return {
				intent: 'general',
				confidence: 0.45,
				auto_tools: ['traces', 'active_file'],
				tool_hints: ['source_excerpt'],
				reason: 'no strong pattern detected, falling back to general'
			};
		}
	};

	function hasAny(text, keywords) {
		for (var i = 0; i < keywords.length; i++) {
			if (text.indexOf(keywords[i]) !== -1) return true;
		}
		return false;
	}

	function extractFilePath(text) {
		// Match patterns like pages/home.fuwa, runtime/stdlib/db.lua, app.fuwa
		var match = text.match(/([\w\/-]+\.(?:fuwa|lua|js|css))/i);
		return match ? match[1] : null;
	}
})();
