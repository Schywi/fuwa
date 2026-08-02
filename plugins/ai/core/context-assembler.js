(function () {
	'use strict';

	var MAX_CONTEXT_TOKENS = 512;
	var MAX_EXCERPT_LINES = 80;
	var MAX_SELECTED_CHARS = 1200;
	var MAX_TERMINAL_LINES = 30;
	var MAX_TRACE_ITEMS = 3;

	function classifyQuestion(text) {
		if (window.FuwaAIClassifier && typeof window.FuwaAIClassifier.classify === 'function') {
			return window.FuwaAIClassifier.classify(text);
		}
		return {
			intent: 'general',
			confidence: 0,
			auto_tools: [],
			tool_hints: [],
			reason: 'classifier unavailable'
		};
	}

	function assembleTextTask(text) {
		var question = normalizeText(text);
		var classification = classifyQuestion(question);
		var task = resolveTask(question, classification);
		if (task === 'fallback') {
			return {
				task: 'fallback',
				intent: classification.intent,
				confidence: classification.confidence,
				question: question,
				context_items: [],
				context_summary: 'fallback to compatibility agent',
				prompt: question,
				limits: {
					max_context_tokens: MAX_CONTEXT_TOKENS
				}
			};
		}

		var context_items = task === 'summarize'
			? buildSummarizeContext(question, classification)
			: buildExplainContext(question, classification);

		return {
			task: task,
			intent: classification.intent,
			confidence: classification.confidence,
			question: question,
			context_items: context_items,
			context_summary: summarizeContext(context_items),
			prompt: formatPrompt(task, question, context_items, classification),
			limits: {
				max_context_tokens: MAX_CONTEXT_TOKENS,
				max_excerpt_lines: MAX_EXCERPT_LINES,
				max_terminal_lines: MAX_TERMINAL_LINES,
				max_trace_items: MAX_TRACE_ITEMS
			}
		};
	}

	function resolveTask(question, classification) {
		var lower = (question || '').toLowerCase();
		if (hasAny(lower, ['summarize', 'summary', 'recap', 'tl;dr'])) {
			return 'summarize';
		}
		if (classification.intent === 'explain_code') {
			return 'explain';
		}
		if (classification.intent === 'debug_failure' || classification.intent === 'perf_analysis' || classification.intent === 'analyze_traces') {
			return 'summarize';
		}
		return 'fallback';
	}

	function buildExplainContext(question) {
		var items = [];
		var tools = window.FuwaAITools || {};
		var path = extractFilePath(question);
		var sources = tools.sources;

		if (sources && typeof sources.collectSelection === 'function') {
			pushItems(items, sources.collectSelection({ max_chars: MAX_SELECTED_CHARS }));
		}
		if (sources && typeof sources.collectActiveFile === 'function') {
			pushItems(items, sources.collectActiveFile());
		}
		if (sources && typeof sources.collectPrimaryExcerpt === 'function') {
			pushItems(items, sources.collectPrimaryExcerpt({
				path: path,
				max_lines: MAX_EXCERPT_LINES,
				max_chars: MAX_SELECTED_CHARS * 2
			}));
		} else if (sources && path && typeof sources.collectExcerpt === 'function') {
			pushItems(items, sources.collectExcerpt(path, 1, MAX_EXCERPT_LINES));
		}

		return items;
	}

	function buildSummarizeContext(question) {
		var items = [];
		var tools = window.FuwaAITools || {};
		var terminal = tools.terminal;
		var traces = tools.traces;
		var sources = tools.sources;
		var path = extractFilePath(question);

		if (terminal && typeof terminal.collectFormatted === 'function') {
			pushItems(items, terminal.collectFormatted(MAX_TERMINAL_LINES, 'error_first'));
		}
		if (traces && typeof traces.collectFormatted === 'function') {
			pushItems(items, traces.collectFormatted(MAX_TRACE_ITEMS));
		}
		if (sources && typeof sources.collectActiveFile === 'function') {
			pushItems(items, sources.collectActiveFile());
		}
		if (sources && typeof sources.collectPrimaryExcerpt === 'function') {
			pushItems(items, sources.collectPrimaryExcerpt({
				path: path,
				max_lines: 40,
				max_chars: MAX_SELECTED_CHARS
			}));
		}

		return items;
	}

	function pushItems(items, collection) {
		if (!collection || !collection.items || collection.items.length === 0) return;
		items.push(collection);
	}

	function summarizeContext(items) {
		if (!items || items.length === 0) return 'no bounded context';
		return items.map(function (collection) {
			return collection.type + ':' + collection.items.length;
		}).join(', ');
	}

	function formatPrompt(task, question, items, classification) {
		var sections = [
			'TASK: ' + task,
			'INTENT: ' + classification.intent,
			'QUESTION:',
			question,
			'CONTEXT LIMITS:',
			'- max_context_tokens=' + MAX_CONTEXT_TOKENS,
			'- bounded_context_only=true',
			'CONTEXT:'
		];
		var body = formatCollections(items);
		sections.push(body || '(no context available)');
		sections.push('ANSWER RULES:');
		sections.push('- Use only the bounded context above.');
		sections.push('- If context is missing, say what is missing.');
		sections.push('- Keep the answer concise and specific.');
		return sections.join('\n');
	}

	function formatCollections(items) {
		if (!items || items.length === 0) return '';
		var lines = [];
		items.forEach(function (collection) {
			lines.push('[' + collection.type + ']');
			collection.items.forEach(function (item) {
				appendItemLines(lines, collection.type, item);
			});
		});
		return lines.join('\n');
	}

	function appendItemLines(lines, type, item) {
		if (type === 'selected_text') {
			lines.push('path: ' + item.path);
			lines.push('text:');
			lines.push(item.text);
			return;
		}
		if (type === 'active_file') {
			lines.push('path: ' + item.path);
			lines.push('line_count: ' + item.line_count);
			return;
		}
		if (type === 'source_excerpt') {
			lines.push('path: ' + item.path + ' lines ' + item.start_line + '-' + item.end_line + ' of ' + item.total_lines);
			lines.push('text:');
			lines.push(item.text);
			return;
		}
		if (type === 'terminal_error') {
			lines.push('message: ' + item.message);
			if (item.file) lines.push('file: ' + item.file + (item.line ? ':' + item.line : ''));
			return;
		}
		if (type === 'terminal_output') {
			lines.push('text:');
			lines.push(item.text);
			return;
		}
		if (type === 'trace_summary') {
			lines.push(item.method + ' ' + item.path + ' -> ' + item.status + ' in ' + item.duration_ms + 'ms');
			return;
		}
		lines.push(JSON.stringify(item));
	}

	function extractFilePath(text) {
		var match = String(text || '').match(/([\w./-]+\.(?:fuwa|lua|js|css))/i);
		return match ? match[1] : null;
	}

	function hasAny(text, values) {
		for (var i = 0; i < values.length; i++) {
			if (text.indexOf(values[i]) !== -1) return true;
		}
		return false;
	}

	function normalizeText(text) {
		return String(text || '').replace(/\s+/g, ' ').trim();
	}

	window.FuwaAIContextAssembler = {
		assembleTextTask: assembleTextTask,
		extractFilePath: extractFilePath
	};
})();
