(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});
	const gsapScriptId = 'fuwa-ide-gsap';
	const tenantBase =
		typeof window.__FUWA_IDE_TENANT_BASE__ === 'string' && window.__FUWA_IDE_TENANT_BASE__.trim()
			? window.__FUWA_IDE_TENANT_BASE__.trim()
			: '/code/tenant';

	const loadOnce = (id, createNode) => {
		if (document.getElementById(id)) return;
		const node = createNode();
		node.id = id;
		document.head.appendChild(node);
	};

	// Reliable kaomoji depend on the rounded font being present; GSAP drives the
	// feed animation. Both are loaded once from the tenant static bundle.
	const ensureExternalDependencies = () => {
		loadOnce('fuwa-gomen-fonts', () => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href =
				'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800;900&family=Nunito:wght@600;700;800;900&display=swap';
			return link;
		});

		if (window.gsap || document.getElementById(gsapScriptId)) return;

		loadOnce(gsapScriptId, () => {
			const script = document.createElement('script');
			script.src = `${tenantBase}/gsap.min.js`;
			return script;
		});
	};

	// Hot-swap cleanup from a previous mount (decay timer, etc).
	if (typeof window.__fuwaGomenCleanup === 'function') {
		try {
			window.__fuwaGomenCleanup();
		} catch (error) {
			/* previous cleanup failed — ignore */
		}
		window.__fuwaGomenCleanup = null;
	}

	ensureExternalDependencies();
	console.log('[browser] Fuwa Gomen ready');

	const root = document.getElementById('gomen');
	const ds = root ? root.dataset : {};

	G.bootstrap = {
		root,
		queryRef: (name) => (root ? root.querySelector(`[data-ref="${name}"]`) : null),
		queryRefs: (name) => (root ? Array.from(root.querySelectorAll(`[data-ref="${name}"]`)) : []),
		// Seeded by the Fuwa `index` action via data-* on the root (real DB state).
		initialState: {
			balance: Number(ds.balance),
			spent: Number(ds.spent),
			pokes: Number(ds.pokes)
		}
	};
})();
