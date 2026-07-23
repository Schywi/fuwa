(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	G.createScope = function createScope(serverData) {
		const boot = G.bootstrap;
		const C = G.content;
		const cfg = C.CONFIG;
		const fx = G.fx.createFx(boot.root, boot.queryRef);

		const byId = {};
		C.ITEMS.forEach((item) => {
			byId[item.id] = item;
		});

		const persist = (url) => {
			try {
				const xhr = new XMLHttpRequest();
				xhr.open('GET', url);
				xhr.send();
			} catch (error) {
			}
		};

		const scope = {
			balance: Number.isFinite(serverData.balance) ? serverData.balance : cfg.allowance,
			spent: Number.isFinite(serverData.spent) ? serverData.spent : 0,
			pokes: Number.isFinite(serverData.pokes) ? serverData.pokes : 0,
			counts: {},
			animating: false,
			animatedTotal: 0,
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
				const derived = G.mood.derive(this.balance, this.pokes);
				return { jp: derived.jp, en: derived.en };
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
				return C.ITEMS.filter((item) => this.counts[item.id]).map((item) => ({
					id: item.id,
					icon: item.icon,
					name: item.name,
					qty: this.counts[item.id],
					lineTotal: this.counts[item.id] * item.price
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

		const seed = boot.queryRef('seed');
		if (seed) {
			seed.querySelectorAll('[data-id]').forEach((el) => {
				const id = el.getAttribute('data-id');
				if (id && byId[id]) scope.counts[id] = (scope.counts[id] || 0) + 1;
			});
			seed.remove();
		}
		scope.animatedTotal = scope.total;

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
