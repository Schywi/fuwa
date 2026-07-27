// Tool registry: assembles AI context from categorized data providers.
// Each tool is a single-responsibility function that returns formatted text.
// Always-tools are included in every request. On-demand tools are triggered
// by keyword matching in the user's message.

// Registry is populated by the individual tool files as they load.
// This file just provides the assembly logic.

(function () {
	'use strict';

	window.FuwaAITools = window.FuwaAITools || {};

	var registry = [];

	// Called by each tool file after defining its tool
	window.FuwaAITools.register = function (tool) {
		// Deduplicate by name
		for (var i = 0; i < registry.length; i++) {
			if (registry[i].name === tool.name) {
				registry[i] = tool;
				return;
			}
		}
		registry.push(tool);
	};

	// List all registered tools with their descriptions
	window.FuwaAITools.list = function () {
		return registry.map(function (t) {
			return t.name + ': ' + t.describe + ' (' + t.cost + ')' + (t.always ? ' [auto]' : '');
		});
	};

	// Build the full context string for the system prompt.
	// requested_tools: optional array of tool names to include beyond the always-set.
	// Returns {context: string, tool_descriptions: string}
	window.FuwaAITools.buildContext = function (user_message) {
		var always_parts = [];
		var tool_lines = [];
		var requested = resolveRequestedTools(user_message);

		registry.forEach(function (tool) {
			if (tool.always) {
				var text = tool.collect();
				if (text) always_parts.push(text);
			}
			tool_lines.push('- ' + tool.describe + (tool.always ? ' (auto)' : ''));
		});

		// Build the full system context
		var context = always_parts.join('\n\n');

		// Tool reference for the system prompt
		var tools_ref = 'Available tools:\n' + tool_lines.map(function (l) { return '  ' + l; }).join('\n');

		return {
			context: context,
			tools_ref: tools_ref,
			requested_tools: requested
		};
	};

	// Collect on-demand tools asynchronously. Returns additional context string.
	window.FuwaAITools.collectOnDemand = async function (requested_tools) {
		if (!requested_tools || requested_tools.length === 0) return '';

		var parts = [];

		for (var i = 0; i < registry.length; i++) {
			var tool = registry[i];
			if (tool.always) continue;

			var should_collect = false;
			for (var j = 0; j < requested_tools.length; j++) {
				if (tool.name === requested_tools[j]) {
					should_collect = true;
					break;
				}
			}
			if (!should_collect) continue;

			if (typeof tool.collectAsync === 'function') {
				try {
					var sub = requested_tools.filter(function (t) { return t === tool.name || tool.triggers.indexOf(t) !== -1; });
					var text = await tool.collectAsync(sub);
					if (text) parts.push(text);
				} catch (e) {
					parts.push('### ' + tool.name + '\n(error: ' + e.message + ')');
				}
			} else {
				var text = tool.collect();
				if (text) parts.push(text);
			}
		}

		return parts.join('\n\n');
	};

	// Trigger trace prefetch on load
	window.FuwaAITools.prefetch = function () {
		registry.forEach(function (tool) {
			if (tool.always && typeof tool.fetch === 'function') {
				tool.fetch().catch(function () {});
			}
		});
	};

	function resolveRequestedTools(user_message) {
		if (!user_message) return [];
		var lower = user_message.toLowerCase();
		var requested = [];
		registry.forEach(function (tool) {
			if (tool.always) return;
			if (tool.triggers) {
				for (var i = 0; i < tool.triggers.length; i++) {
					if (lower.indexOf(tool.triggers[i]) !== -1) {
						requested.push(tool.name);
						break;
					}
				}
			}
		});
		return requested;
	}
})();
