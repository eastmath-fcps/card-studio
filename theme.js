// Apply before the stylesheet loads
(() => {
	'use strict';
	const STORAGE_KEY = 'card-studio-theme';
	const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
	const root = document.documentElement;
	const themeColor = document.querySelector('meta[name="theme-color"]');
	const validTheme = (value) => value === 'light' || value === 'dark' ? value : null;
	let preference = null;
	let toggle;
	try {
		preference = validTheme(localStorage.getItem(STORAGE_KEY));
	} catch { /* Storage may be blocked; switching still works for this visit. */ }

	function applyTheme() {
		const theme = preference || (systemTheme.matches ? 'dark' : 'light');
		root.dataset.theme = theme;
		if (themeColor) themeColor.content = theme === 'dark' ? '#1c2532' : '#34465d';
		if (toggle) {
			toggle.setAttribute('aria-checked', String(theme === 'light'));
			toggle.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
		}
	}

	applyTheme();
	systemTheme.addEventListener('change', () => {
		if (!preference) applyTheme();
	});
	window.addEventListener('storage', (event) => {
		if (event.key !== STORAGE_KEY && event.key !== null) return;
		try {
			if (event.storageArea !== localStorage) return;
		} catch { return; }
		preference = validTheme(event.newValue);
		applyTheme();
	});
	document.addEventListener('DOMContentLoaded', () => {
		toggle = document.getElementById('themeToggle');
		if (!toggle) return;
		applyTheme();
		toggle.addEventListener('click', () => {
			preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
			applyTheme();
			try {
				localStorage.setItem(STORAGE_KEY, preference);
			} catch { /* Keep the in-memory choice even when persistence is unavailable. */ }
		});
	});
})();
