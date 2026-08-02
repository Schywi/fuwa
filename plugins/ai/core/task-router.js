(function () {
	'use strict';

	var fallback_assembler = null;

	function getAssembler() {
		if (window.FuwaAIContextAssembler) return window.FuwaAIContextAssembler;
		if (!fallback_assembler) {
			fallback_assembler = createFallbackAssembler();
		}
		return fallback_assembler;
	}

	function getCompat() {
		return window.FuwaAIProviderCompat;
	}

	function createFallbackAssembler() {
		var MAX_CONTEXT_TOKENS = 512;

		function extractFilePath(text) {
			var match = String(text || '').match(/([\w./-]+\.(?:fuwa|lua|js|css))/i);
			return match ? match[1] : null;
		}

		function resolveTask(question, intent) {
			var lower = String(question || '').toLowerCase();
			if (lower.indexOf('summarize') !== -1) {
				return 'summarize';
			}
			if (intent === 'explain_code') {
				return 'explain';
			}
			if (intent === 'debug_failure' || intent === 'perf_analysis' || intent === 'analyze_traces') {
				return 'summarize';
			}
			return 'fallback';
		}

		function classify(question) {
			if (window.FuwaAIClassifier && typeof window.FuwaAIClassifier.classify === 'function') {
				return window.FuwaAIClassifier.classify(question);
			}
			return { intent: 'general', confidence: 0 };
		}

		function formatCollections(items) {
			var lines = [];
			for (var i = 0; i < items.length; i++) {
				var collection = items[i];
				lines.push('[' + collection.type + ']');
				for (var j = 0; j < collection.items.length; j++) {
					var item = collection.items[j];
					if (collection.type === 'active_file') {
						lines.push('path: ' + item.path);
						lines.push('line_count: ' + item.line_count);
					} else if (collection.type === 'selected_text') {
						lines.push('path: ' + item.path);
						lines.push('text:');
						lines.push(item.text);
					} else if (collection.type === 'source_excerpt') {
						lines.push('path: ' + item.path + ' lines ' + item.start_line + '-' + item.end_line + ' of ' + item.total_lines);
						lines.push('text:');
						lines.push(item.text);
					} else if (collection.type === 'terminal_error') {
						lines.push('message: ' + item.message);
						if (item.file) lines.push('file: ' + item.file + (item.line ? ':' + item.line : ''));
					} else if (collection.type === 'trace_summary') {
						lines.push(item.method + ' ' + item.path + ' -> ' + item.status + ' in ' + item.duration_ms + 'ms');
					} else if (collection.type === 'terminal_output') {
						lines.push('text:');
						lines.push(item.text);
					}
				}
			}
			return lines.join('\n');
		}

		function summarizeContext(items) {
			if (!items.length) return 'no bounded context';
			return items.map(function (collection) {
				return collection.type + ':' + collection.items.length;
			}).join(', ');
		}

		function push(items, collection) {
			if (collection && collection.items && collection.items.length > 0) {
				items.push(collection);
			}
		}

		return {
			assembleTextTask: function (text) {
				var question = String(text || '').replace(/\s+/g, ' ').trim();
				var classification = classify(question);
				var task = resolveTask(question, classification.intent);
				if (task === 'fallback') {
					return {
						task: 'fallback',
						intent: classification.intent,
						question: question,
						context_items: [],
						context_summary: 'fallback to compatibility agent',
						prompt: question,
						limits: { max_context_tokens: MAX_CONTEXT_TOKENS }
					};
				}

				var items = [];
				var tools = window.FuwaAITools || {};
				var path = extractFilePath(question);
				if (task === 'explain') {
					if (tools.sources && typeof tools.sources.collectSelection === 'function') {
						push(items, tools.sources.collectSelection({ max_chars: 1200 }));
					}
					if (tools.sources && typeof tools.sources.collectActiveFile === 'function') {
						push(items, tools.sources.collectActiveFile());
					}
					if (tools.sources && typeof tools.sources.collectPrimaryExcerpt === 'function') {
						push(items, tools.sources.collectPrimaryExcerpt({ path: path, max_lines: 80, max_chars: 2400 }));
					}
				} else {
					if (tools.terminal && typeof tools.terminal.collectFormatted === 'function') {
						push(items, tools.terminal.collectFormatted(30, 'error_first'));
					}
					if (tools.traces && typeof tools.traces.collectFormatted === 'function') {
						push(items, tools.traces.collectFormatted(3));
					}
					if (tools.sources && typeof tools.sources.collectActiveFile === 'function') {
						push(items, tools.sources.collectActiveFile());
					}
					if (tools.sources && typeof tools.sources.collectPrimaryExcerpt === 'function') {
						push(items, tools.sources.collectPrimaryExcerpt({ path: path, max_lines: 40, max_chars: 1200 }));
					}
				}

				return {
					task: task,
					intent: classification.intent,
					question: question,
					context_items: items,
					context_summary: summarizeContext(items),
					limits: { max_context_tokens: MAX_CONTEXT_TOKENS },
					prompt: [
						'TASK: ' + task,
						'INTENT: ' + classification.intent,
						'QUESTION:',
						question,
						'CONTEXT LIMITS:',
						'- max_context_tokens=' + MAX_CONTEXT_TOKENS,
						'- bounded_context_only=true',
						'CONTEXT:',
						formatCollections(items) || '(no context available)'
					].join('\n')
				};
			}
		};
	}

	function buildSystemPrompt(task) {
		return [
			'You are the bounded AI runtime for fuwa.',
			'Return JSON ONLY.',
			'Use the provided task context only. Do not invent files, traces, or runtime facts.',
			'JSON shape: {"answer":"short, specific answer"}'
		].join('\n');
	}

	async function runBoundedTask(task, onStatus) {
		var compat = getCompat();
		if (!(compat && typeof compat.callJsonModel === 'function')) {
			throw new Error('AI provider compatibility layer is not fully initialized.');
		}

		onStatus('Running ' + task.task + ' with bounded context…');
		var result = await compat.callJsonModel([
			{ role: 'system', content: buildSystemPrompt(task) },
			{ role: 'user', content: task.prompt }
		], {
			temperature: 0.1,
			max_tokens: task.task === 'summarize' ? 512 : 768
		});

		return {
			answer: result.answer || result.summary || result.result || 'No answer returned.',
			context_summary: task.context_summary,
			task: task.task
		};
	}

	window.FuwaAITaskRouter = {
		runTextTask: async function (text, onStatus) {
			onStatus = onStatus || function () {};
			onStatus('Classifying task…');

			var assembler = getAssembler();
			if (assembler && typeof assembler.assembleTextTask === 'function') {
				var task = assembler.assembleTextTask(text);
				if (task && task.task !== 'fallback') {
					onStatus('Assembling bounded context…');
					return runBoundedTask(task, onStatus);
				}
			}

			onStatus('Routing task…');
			var compat = getCompat();
			if (!(compat && typeof compat.analyzeQuestion === 'function')) {
				throw new Error('AI task router is not fully initialized.');
			}

			return compat.analyzeQuestion(text, onStatus);
		},
	};
})();
