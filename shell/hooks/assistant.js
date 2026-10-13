(function () {
	'use strict';

	// Native fuwa chat for the cluster assistant. Talks to the assistant's JSON
	// API directly (CORS allows the shell origin) and renders each evidence
	// deep link as an in-panel button instead of a target=_blank anchor.
	var ASSISTANT_URL = 'http://192.168.0.243';
	var SESSION_KEY = 'fuwa-assistant-session';

	function log(step, detail) {
		if (detail === undefined) {
			console.info('[shell:assistant] ' + step);
			return;
		}
		console.info('[shell:assistant] ' + step, detail);
	}

	function sessionId() {
		try {
			var existing = window.localStorage.getItem(SESSION_KEY);
			if (existing) return existing;
			var created = 'fuwa-' + Math.random().toString(36).slice(2, 10);
			window.localStorage.setItem(SESSION_KEY, created);
			return created;
		} catch (err) {
			return 'fuwa-anon';
		}
	}

	function linkLabel(name) {
		var text = String(name || '');
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	function createState() {
		return {
			messages: [],
			input: '',
			busy: false,
			session: sessionId(),
			linkLabel: linkLabel,
			send: function () {
				var self = this;
				var text = (self.input || '').trim();
				if (text === '' || self.busy) {
					return;
				}
				self.input = '';
				self.messages.push({ role: 'user', text: text });
				self.busy = true;

				window
					.fetch(ASSISTANT_URL + '/investigate', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ message: text, session: self.session })
					})
					.then(function (response) {
						if (!response.ok) {
							throw new Error('assistant responded ' + response.status);
						}
						return response.json();
					})
					.then(function (data) {
						self.messages.push({
							role: 'assistant',
							text: data.reply || data.screen_md || '',
							facts: data.facts || [],
							metrics: data.metrics || null
						});
					})
					.catch(function (error) {
						log('send failed', error.message);
						self.messages.push({ role: 'assistant', text: 'error: ' + error.message, error: true });
					})
					.then(function () {
						self.busy = false;
					});
			},
			openLink: function (url) {
				if (url && window.FuwaShellWorkspace && typeof window.FuwaShellWorkspace.openPanel === 'function') {
					window.FuwaShellWorkspace.openPanel(url);
					return;
				}
				if (url) {
					window.open(url, '_blank', 'noopener');
				}
			}
		};
	}

	window.FuwaAssistant = { createState: createState };
})();
