(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	G.fx = {
		createFx(root, queryRef) {
			const cfg = G.content.CONFIG;

			const flyFoodToMouth = (foodEl, onArrive, onDone) => {
				const gsap = window.gsap;
				const mouth = queryRef('mouth');
				if (!gsap || !foodEl || !mouth) {
					if (onArrive) onArrive();
					if (onDone) onDone();
					return;
				}

				const icon = foodEl.querySelector('.fg-food-icon') || foodEl;
				const fr = icon.getBoundingClientRect();
				const mr = mouth.getBoundingClientRect();
				const clone = icon.cloneNode(true);

				clone.style.position = 'fixed';
				clone.style.left = `${fr.left}px`;
				clone.style.top = `${fr.top}px`;
				clone.style.margin = '0';
				clone.style.zIndex = '9999';
				clone.style.pointerEvents = 'none';
				document.body.appendChild(clone);

				const dx = mr.left + mr.width / 2 - (fr.left + fr.width / 2);
				const dy = mr.top + mr.height / 2 - (fr.top + fr.height / 2);
				const total = cfg.flyMs / 1000;

				let arrived = false;
				const arrive = () => {
					if (arrived) return;
					arrived = true;
					if (onArrive) onArrive();
				};

				gsap
					.timeline({
						onComplete: () => {
							clone.remove();
							if (onDone) onDone();
						}
					})
					.to(clone, {
						x: dx * 0.6,
						y: dy * 0.6 - 28,
						scale: 1.4,
						duration: total * 0.6,
						ease: 'power1.out'
					})
					.add(arrive)
					.to(clone, {
						x: dx,
						y: dy,
						scale: 0.2,
						opacity: 0,
						duration: total * 0.4,
						ease: 'power1.in'
					});
			};

			const chew = () => {
				const gsap = window.gsap;
				const mouth = queryRef('mouth');
				if (!gsap || !mouth) return;
				gsap.fromTo(
					mouth,
					{ scale: 1 },
					{ scale: 1.12, duration: cfg.chewMs / 1000 / 2, yoyo: true, repeat: 1, ease: 'power1.inOut' }
				);
			};

			const pokeReact = () => {
				const gsap = window.gsap;
				if (!gsap || !root) return;
				gsap.fromTo(root, { x: 0 }, { x: -6, duration: 0.05, yoyo: true, repeat: 5, ease: 'power1.inOut' });
			};

			const spit = (foodEl) => {
				const gsap = window.gsap;
				if (!gsap || !foodEl) return;
				gsap.fromTo(foodEl, { y: 0 }, { y: -8, duration: 0.08, yoyo: true, repeat: 3, ease: 'power1.out' });
			};

			return { flyFoodToMouth, chew, pokeReact, spit };
		}
	};
})();
