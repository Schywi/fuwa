(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	const loadOnce = (id, createNode) => {
		if (document.getElementById(id)) return;
		const node = createNode();
		node.id = id;
		document.head.appendChild(node);
	};

	const ensureExternalDependencies = () => {
		loadOnce('fuwa-gomen-fonts', () => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href =
				'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800;900&family=Nunito:wght@600;700;800;900&display=swap';
			return link;
		});
		loadOnce('fuwa-gomen-gsap', () => {
			const script = document.createElement('script');
			script.src = '/vendor/gsap/gsap-3.15.0.min.js';
			return script;
		});
	};

	if (typeof window.__fuwaGomenCleanup === 'function') {
		try {
			window.__fuwaGomenCleanup();
		} catch (error) {
		}
		window.__fuwaGomenCleanup = null;
	}

	ensureExternalDependencies();

	const root = document.getElementById('gomen');

	G.bootstrap = {
		root,
		queryRef: (name) => (root ? root.querySelector(`[data-ref="${name}"]`) : null),
		queryRefs: (name) => (root ? Array.from(root.querySelectorAll(`[data-ref="${name}"]`)) : [])
	};
})();
