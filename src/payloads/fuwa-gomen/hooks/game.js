(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	// petite-vue provides the @click wiring via v-scope="FuwaGomen.createScope()".
	// Gameplay state lives in the closure object `S`; all visual updates are done
	// imperatively through data-ref nodes (the gomen-v2 / postbox idiom), so we do
	// NOT depend on capturing petite-vue's reactive proxy. The server owns
	// durability: each action fires a fire-and-forget XHR to its Fuwa route.
	G.createScope = function createScope() {
		const boot = G.bootstrap;
		const C = G.content;
		const cfg = C.CONFIG;
		const init = boot.initialState;
		const fx = G.fx.createFx(boot.root, boot.queryRef);

		const byId = {};
		C.ITEMS.forEach((it) => {
			byId[it.id] = it;
		});

		const S = {
			balance: Number.isFinite(init.balance) ? init.balance : cfg.allowance,
			spent: Number.isFinite(init.spent) ? init.spent : 0,
			pokes: Number.isFinite(init.pokes) ? init.pokes : 0,
			counts: {}, // item id -> quantity bought
			animating: false
		};

		const ref = (name) => boot.queryRef(name);

		const setFace = (html) => {
			const mouth = ref('mouth');
			if (mouth) mouth.innerHTML = html;
		};

		const setBubble = (jp, en) => {
			const j = ref('bubble-jp');
			const e = ref('bubble-en');
			if (j) j.textContent = jp;
			if (e) e.textContent = en;
		};

		// ── receipt (aggregated: one line per item, ×qty, line total) ──────────
		let shownTotal = 0;

		const animateTotal = (target) => {
			const el = ref('total');
			if (!el) return;
			const gsap = window.gsap;
			if (!gsap) {
				el.textContent = `-¥${target}`;
				shownTotal = target;
				return;
			}
			const obj = { v: shownTotal };
			gsap.to(obj, {
				v: target,
				duration: 0.45,
				ease: 'power1.out',
				onUpdate: () => {
					el.textContent = `-¥${Math.round(obj.v)}`;
				},
				onComplete: () => {
					shownTotal = target;
				}
			});
		};

		const renderReceipt = () => {
			const list = ref('receipt');
			if (!list) return;
			list.innerHTML = '';
			let total = 0;
			C.ITEMS.forEach((it) => {
				const qty = S.counts[it.id] || 0;
				if (!qty) return;
				const line = qty * it.price;
				total += line;
				const row = document.createElement('div');
				row.className = 'fg-receipt-row';
				row.innerHTML =
					`<span class="fg-receipt-icon">${it.icon}</span>` +
					`<span class="fg-receipt-name">${it.name}</span>` +
					`<span class="fg-receipt-qty">×${qty}</span>` +
					'<span class="fg-receipt-dots"></span>' +
					`<span class="fg-receipt-price">-¥${line}</span>`;
				list.appendChild(row);
			});
			animateTotal(total);
		};

		// Seed counts from the server-rendered ledger rows, then drop the seed.
		const seedCounts = () => {
			const seed = ref('seed');
			if (!seed) return;
			seed.querySelectorAll('[data-id]').forEach((el) => {
				const id = el.getAttribute('data-id');
				if (id && byId[id]) S.counts[id] = (S.counts[id] || 0) + 1;
			});
			seed.remove();
		};

		const setBar = () => {
			const fill = ref('fill');
			const text = ref('bar-text');
			const pct = Math.max(0, Math.min(100, S.balance / (cfg.allowance / 100)));
			if (fill) {
				fill.style.width = `${pct}%`;
				fill.classList.toggle('is-low', S.balance < 300);
			}
			if (text) text.textContent = `¥${S.balance} · spent ¥${S.spent}`;
		};

		// Paint the derived mood (face + bubble + papa + tint) from S.
		const render = () => {
			const d = G.mood.derive(S.balance, S.pokes);
			setFace(d.face);
			setBubble(d.jp, d.en);
			if (boot.root) boot.root.setAttribute('data-mood', d.moodKey);
			const papa = ref('papa');
			if (papa) papa.style.display = d.papa ? 'flex' : 'none';
			setBar();
		};

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

		// Anger cools down on its own; /cooldown keeps the DB in step.
		const decayTimer = window.setInterval(() => {
			if (S.pokes > 0) {
				S.pokes -= 1;
				render();
				persist('/cooldown');
			}
		}, cfg.decayMs);

		window.__fuwaGomenCleanup = () => {
			window.clearInterval(decayTimer);
			window.__fuwaGomenCleanup = null;
		};

		// initial paint from real DB state
		seedCounts();
		render();
		renderReceipt();

		return {
			feed(id, event) {
				if (S.animating) return;
				const item = byId[id];
				if (!item) return;
				const foodEl = event && event.currentTarget;

				if (S.balance < item.price) {
					setFace(C.FACES.angry);
					setBubble(C.COPY.refuse.jp, C.COPY.refuse.en);
					fx.spit(foodEl);
					window.setTimeout(render, 900);
					return;
				}

				S.animating = true;
				setFace(C.FACES.open);

				fx.flyFoodToMouth(
					foodEl,
					() => {
						S.balance -= item.price;
						S.spent += item.price;
						S.counts[id] = (S.counts[id] || 0) + 1;
						setBar();
						setFace(C.FACES.chew);
						fx.chew();
						renderReceipt();
					},
					() => {
						S.animating = false;
						render();
						persist(`/buy/${id}`);
					}
				);
			},

			poke() {
				S.pokes += 1;
				render();
				fx.pokeReact();
				persist('/poke');
			},

			pet() {
				S.pokes = 0;
				render();
				persist('/calm');
			},

			askPapa() {
				S.balance = cfg.allowance;
				S.spent = 0;
				S.pokes = 0;
				S.counts = {};
				renderReceipt();
				render();
				persist('/reset');
			}
		};
	};
})();
