(function () {
	'use strict';

	const G = window.FuwaGomen || (window.FuwaGomen = {});

	G.mood = {
		derive(balance, pokes) {
			const F = G.content.FACES;
			const C = G.content.COPY;
			let key;

			if (balance <= 0) key = 'crying';
			else if (pokes >= 5) key = 'tantrum';
			else if (balance < 300) key = 'worried';
			else if (pokes >= 3) key = 'annoyed';
			else if (pokes >= 1) key = 'stern';
			else if (balance >= 800) key = 'happy';
			else key = 'neutral';

			return {
				moodKey: key,
				face: F[key],
				jp: C[key].jp,
				en: C[key].en,
				papa: balance <= 0
			};
		}
	};
})();
