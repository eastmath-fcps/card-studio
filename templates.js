// Load before script.js so opening index.html directly works.

// Paper-stock catalog. All geometry uses inches; 1 inch = 96 CSS px = 72 PDF pt.
(() => {
	'use strict';
	const deepFreeze = (value) => {
		Object.values(value).forEach((child) => {
			if (child && typeof child === 'object') deepFreeze(child);
		});
		return Object.freeze(value);
	};
	const geometries = deepFreeze({
		'letter-business-10': {
			page: {
				width: 8.5,
				height: 11,
				name: 'Letter',
				orientation: 'Portrait'
			},
			card: {
				width: 3.5,
				height: 2,
				radius: 0
			},
			grid: {
				columns: 2,
				rows: 5,
				left: 0.75,
				top: 0.5,
				gapX: 0,
				gapY: 0
			},
			safeInset: 0.125,
		},
		'letter-shipping-10': {
			page: {
				width: 8.5,
				height: 11,
				name: 'Letter',
				orientation: 'Portrait'
			},
			card: {
				width: 4,
				height: 2,
				radius: 0.2
			},
			grid: {
				columns: 2,
				rows: 5,
				left: 11.2001 / 72, // left edge in inches
				top: 0.5,
				gapX: 13.5503 / 72, // column gap in inches
				gapY: 0,
			},
			safeInset: 0.125,
		},
		'letter-address-30': {
			page: {
				width: 8.5,
				height: 11,
				name: 'Letter',
				orientation: 'Portrait'
			},
			card: {
				width: 2.625,
				height: 1,
				radius: 0.1
			},
			// 3-col
			grid: {
				columns: 3,
				rows: 10,
				left: 0.1875,
				top: 0.5,
				gapX: 0.125,
				gapY: 0
			},
			safeInset: 0.125,
		},
	});
	// IDs are saved with layouts; compatible templates share geometry while retaining the product number selected by the user.
	const stocks = deepFreeze([
		{
			id: 'avery-5911', name: 'Avery 5911', description: 'Business cards',
			geometryId: 'letter-business-10', source: 'https://www.avery.com/templates/5911',
		},
		{
			id: 'avery-58163', name: 'Avery 58163', description: 'Repositionable shipping labels',
			geometryId: 'letter-shipping-10', source: 'https://www.avery.com/templates/58163',
		},
		{
			id: 'avery-5523', name: 'Avery 5523', description: 'WeatherProof address labels',
			geometryId: 'letter-shipping-10', source: 'https://www.avery.com/templates/5523',
		},
		{
			id: 'avery-5160', name: 'Avery 5160', description: 'Address labels',
			geometryId: 'letter-address-30', source: 'https://www.avery.com/templates/5160',
		},
	]);
	const defaultId = 'avery-5911'; // default to Avery 5911 cards
	const templates = stocks.map((stock) => deepFreeze({ ...stock, ...geometries[stock.geometryId] }));
	function get(id = defaultId) {
		const template = templates.find((item) => item.id === id);
		if (!template) throw Error(`Unsupported paper stock: ${String(id)}. Update Card Studio to open this layout.`);
		return template;
	}
	const catalog = Object.freeze({ defaultId, geometries, stocks, get });
	if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
	else globalThis.CardStudioTemplates = catalog;
})();