(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	// petite-vue provides the @click wiring via v-scope. The returned object IS
	// the reactive scope: state fields, computed getters, and action methods
	// all live on one object so petite-vue's proxy tracks every read/write and
	// the template re-renders itself — no manual DOM painting. The server owns
	// durability: each action fires a fire-and-forget XHR to its Fuwa route.
	G.createScope = function createScope(serverData) {
		const boot = G.bootstrap;
		const C = G.content;
		const cfg = C.CONFIG;
		const fx = G.fx.createFx(boot.root, boot.queryRef);

		const byId = {};
		C.ITEMS.forEach((it) => {
			byId[it.id] = it;
		});

		const persist = (url) => {
			try {
				// Use XMLHttpRequest, not fetch: the runtime bridge shims
				// window.XMLHttpRequest to route same-origin app routes into the
				// in-browser Lua server (which writes the DB). A raw fetch()
				// bypasses that shim and hits the real origin, so the Fuwa action
				// never runs. Fire-and-forget — we ignore the reply (no DOM swap),
				// the client already painted optimistically.
				const xhr = new XMLHttpRequest();
				xhr.open('GET', url);
				xhr.send();
			} catch (error) {
				/* offline / sandbox — client stays optimistic */
			}
		};

		const scope = {
			balance: Number.isFinite(serverData.balance) ? serverData.balance : cfg.allowance,
			spent: Number.isFinite(serverData.spent) ? serverData.spent : 0,
			pokes: Number.isFinite(serverData.pokes) ? serverData.pokes : 0,
			counts: {}, // item id -> quantity bought
			animating: false,
			animatedTotal: 0,
			// Transient overrides on top of the derived mood: a refused purchase
			// flashes an angry face, and eating has its own open/chew frames.
			refusing: false,
			eatingPhase: null,

			get moodKey() {
				return G.mood.derive(this.balance, this.pokes).moodKey;
			},
			get face() {
				if (this.refusing) return C.FACES.angry;
				if (this.eatingPhase) return C.FACES[this.eatingPhase];
				return G.mood.derive(this.balance, this.pokes).face;
			},
			get currentMood() {
				if (this.refusing) return C.COPY.refuse;
				const d = G.mood.derive(this.balance, this.pokes);
				return { jp: d.jp, en: d.en };
			},
			get papaVisible() {
				return this.balance <= 0;
			},
			get barPercent() {
				return Math.max(0, Math.min(100, this.balance / (cfg.allowance / 100)));
			},
			get barText() {
				return `¥${this.balance} · spent ¥${this.spent}`;
			},
			get receiptRows() {
				return C.ITEMS.filter((it) => this.counts[it.id]).map((it) => ({
					id: it.id,
					icon: it.icon,
					name: it.name,
					qty: this.counts[it.id],
					lineTotal: this.counts[it.id] * it.price
				}));
			},
			get total() {
				return this.receiptRows.reduce((sum, row) => sum + row.lineTotal, 0);
			},
			get totalText() {
				return `-¥${Math.round(this.animatedTotal)}`;
			},

			animateTotal(target) {
				const gsap = window.gsap;
				if (!gsap) {
					this.animatedTotal = target;
					return;
				}
				gsap.to(this, { animatedTotal: target, duration: 0.45, ease: 'power1.out' });
			},

			feed(id, event) {
				if (this.animating) return;
				const item = byId[id];
				if (!item) return;
				const foodEl = event && event.currentTarget;

				if (this.balance < item.price) {
					this.refusing = true;
					fx.spit(foodEl);
					window.setTimeout(() => {
						this.refusing = false;
					}, 900);
					return;
				}

				this.animating = true;
				this.eatingPhase = 'open';

				fx.flyFoodToMouth(
					foodEl,
					() => {
						this.balance -= item.price;
						this.spent += item.price;
						this.counts[id] = (this.counts[id] || 0) + 1;
						this.animateTotal(this.total);
						this.eatingPhase = 'chew';
						fx.chew();
					},
					() => {
						this.animating = false;
						this.eatingPhase = null;
						persist(`/buy/${id}`);
					}
				);
			},

			poke() {
				this.pokes += 1;
				fx.pokeReact();
				persist('/poke');
			},

			pet() {
				this.pokes = 0;
				persist('/calm');
			},

			askPapa() {
				this.balance = cfg.allowance;
				this.spent = 0;
				this.pokes = 0;
				this.counts = {};
				this.animateTotal(0);
				persist('/reset');
			}
		};

		// Seed purchase counts from the server-rendered ledger rows. The view
		// compiler has no JSON encoding for array/table bindings (only scalar
		// `&expr` interpolation), so the receipt list still arrives via a hidden
		// server-rendered `f-for` seed rather than a v-scope argument.
		const seed = boot.queryRef('seed');
		if (seed) {
			seed.querySelectorAll('[data-id]').forEach((el) => {
				const id = el.getAttribute('data-id');
				if (id && byId[id]) scope.counts[id] = (scope.counts[id] || 0) + 1;
			});
			seed.remove();
		}
		scope.animatedTotal = scope.total;

		// Anger cools down on its own; /cooldown keeps the DB in step.
		const decayTimer = window.setInterval(() => {
			if (scope.pokes > 0) {
				scope.pokes -= 1;
				persist('/cooldown');
			}
		}, cfg.decayMs);

		window.__fuwaGomenCleanup = () => {
			window.clearInterval(decayTimer);
			window.__fuwaGomenCleanup = null;
		};

		return scope;
	};

	// petite-vue's vendored IIFE build only self-mounts when its <script> tag
	// carries an `init` attribute (views/layout.fuwa doesn't set one, to match
	// payloads/current's convention), so we mount explicitly once G.createScope
	// is defined and the DOM is ready. The browser tenant iframe already mounts
	// the document once the tenant scripts are replayed, so we skip the direct
	// mount there to avoid double-hydrating the same tree.
	const mountApp = () => {
		const isTenantRuntime = document.body && document.body.dataset && document.body.dataset.browserRuntime === 'tenant';
		if (!isTenantRuntime && window.PetiteVue && typeof window.PetiteVue.createApp === 'function' && G.bootstrap.root) {
			window.PetiteVue.createApp().mount(G.bootstrap.root);
		}
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', mountApp, { once: true });
	} else {
		mountApp();
	}
})();
