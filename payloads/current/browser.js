(function () {
	'use strict';

	function mount(scope) {
		if (!(scope instanceof Element)) {
			return;
		}

		if (window.PetiteVue && typeof window.PetiteVue.createApp === 'function') {
			try {
				window.PetiteVue.createApp().mount(scope);
			} catch (error) {
				console.error('[fuwa/current] petite-vue mount failed', error);
			}
		}

		if (window.htmx && window.htmx.config) {
			window.htmx.config.allowScriptTags = false;
		}

		if (window.htmx && typeof window.htmx.process === 'function') {
			window.htmx.process(scope);
		}
	}

	document.documentElement.dataset.fuwaBrowser = 'current';
	window.FuwaCurrent = {
		payload: 'current'
	};

	mount(document.body);

	document.addEventListener('htmx:afterSwap', (event) => {
		mount(event.detail?.target || event.target || document.body);
	});
})();
