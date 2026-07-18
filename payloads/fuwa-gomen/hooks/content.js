(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	// Blush cheeks (˶) are wrapped so CSS can tint them pink; rendered via innerHTML.
	// All glyphs are taken from the proven feed-me set so they render with the
	// rounded font instead of falling back to tofu.
	const blush = (s) => `<span class="blush">˶</span>${s}<span class="blush">˶</span>`;

	G.content = {
		FACES: {
			neutral: `( ${blush('• ᵕ •')} )`,
			stern: '( ¬_¬ )',
			annoyed: '（ꐦ ¬_¬ ）',
			tantrum: '(ᗒ ᗣ ᗕ)՞',
			worried: `( ${blush('˃ ⤙ ˂')} )`,
			happy: `( ${blush('≧ ᗜ ≦')} )`,
			crying: '( ╥﹏╥ )',
			// transient (animation only)
			open: `( ${blush('• 〇 •')} )`,
			chew: `( ${blush('> ﹏ <')} )`,
			angry: '( ಠ ∧ ಠ )'
		},

		COPY: {
			neutral: { jp: 'ふむ…', en: 'Mama is watching.' },
			stern: { jp: 'こら。', en: 'Behave yourself.' },
			annoyed: { jp: 'やめてって。', en: 'Quit poking me!' },
			tantrum: { jp: 'もう！知らない！', en: "That's IT!" },
			worried: { jp: 'あぶないよ…', en: 'Money is low...' },
			happy: { jp: 'えらいね！', en: 'Good job saving!' },
			crying: { jp: 'ぜんぶ使ったの…', en: 'Papa is crying...' },
			refuse: { jp: 'おかね、ない！', en: 'No money left!' }
		},

		ITEMS: [
			{ id: 'onigiri', icon: '🍙', name: 'Onigiri', price: 50 },
			{ id: 'ramen', icon: '🍜', name: 'Ramen', price: 120 },
			{ id: 'takoyaki', icon: '🐙', name: 'Takoyaki', price: 200 },
			{ id: 'sushi', icon: '🍣', name: 'Sushi', price: 300 }
		],

		CONFIG: {
			allowance: 1000,
			decayMs: 4000,
			flyMs: 520,
			chewMs: 420
		}
	};
})();
