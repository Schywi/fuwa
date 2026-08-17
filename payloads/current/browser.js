(function () {
	'use strict';

	let booted = false;
	let retry_timer = null;

	function dependenciesReady() {
		return (
			window.PetiteVue &&
			typeof window.PetiteVue.createApp === 'function' &&
			window.htmx &&
			typeof window.htmx.process === 'function'
		);
	}

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

	function handleSwap(event) {
		mount(event.detail?.target || event.target || document.body);
	}

	document.addEventListener('htmx:afterSwap', handleSwap);

	function boot() {
		document.documentElement.dataset.fuwaBrowser = 'current';
		window.FuwaCurrent = {
			payload: 'current'
		};

		if (!dependenciesReady()) {
			if (!retry_timer) {
				retry_timer = setTimeout(function () {
					retry_timer = null;
					boot();
				}, 16);
			}
			return;
		}

		if (booted) {
			return;
		}

		booted = true;
		mount(document.body);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot, { once: true });
	} else {
		boot();
	}
})();
