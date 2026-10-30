// Card Studio's offline files and update lifecycle; update VERSION for every release that changes an app file, and deploy all files together.
'use strict';
const VERSION = '1.2.1';
const BASE = self.registration.scope;
const PREFIX = `card-studio:${BASE}:`;
const APP_CACHE = `${PREFIX}app-${VERSION}`;
const FONT_CACHE = `${PREFIX}fonts-1`;
const APP_FILES = [
	'./', 'index.html', 'style.css', 'templates.js', 'google-fonts.js',
	'fonts.js', 'script.js', 'pwa.js', 'manifest.webmanifest', 'sample.csv',
	'assets/card-studio-icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
	'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png',
	'vendor/xlsx.full.min.js',
];
const APP_URLS = new Set(APP_FILES.map((file) => new URL(file, BASE).href));

self.addEventListener('install', (event) => {
	// A failed/missing file prevents this release from replacing the working one. Do not skipWaiting here: an update must wait for the user's consent.
	event.waitUntil((async () => {
		const cache = await caches.open(APP_CACHE);
		await cache.addAll([...APP_URLS].map((url) => new Request(url, { cache: 'reload' })));
	})());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const names = await caches.keys();
		await Promise.all(names.filter((name) => name.startsWith(`${PREFIX}app-`) && name !== APP_CACHE)
			.map((name) => caches.delete(name)));
		await self.clients.claim();
	})());
});

async function cachedApp(request, key) {
	const cache = await caches.open(APP_CACHE);
	return (await cache.match(key)) || fetch(request);
}

async function cachedFont(request) {
	const cache = await caches.open(FONT_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	// CORS-readable successes only: never store an opaque or failed response.
	if (response.ok && ['basic', 'cors'].includes(response.type)) {
		try {
			await cache.put(request, response.clone());
			const keys = await cache.keys();
			await Promise.all(keys.slice(0, Math.max(0, keys.length - 256)).map((key) => cache.delete(key)));
		} catch { /* Full/disabled storage must not prevent a font from loading. */ }
	}
	return response;
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	const key = url.origin + url.pathname;
	// Serve one complete release, including navigations, until an update is accepted. Ignore query strings only for our exact, known static files.
	if (APP_URLS.has(key)) {
		event.respondWith(cachedApp(request, key));
	} else if ((url.origin === 'https://fonts.googleapis.com' && url.pathname === '/css2') ||
		(url.origin === 'https://fonts.gstatic.com' && url.pathname.startsWith('/s/'))) {
		event.respondWith(cachedFont(request));
	}
	// User files, records, layouts, blob URLs, and unrelated URLs are not cached.
});

self.addEventListener('message', (event) => {
	const port = event.ports[0];
	if (!port || !event.source?.url?.startsWith(BASE)) return;
	event.waitUntil((async () => {
		if (event.data?.type === 'STATUS') {
			const cache = await caches.open(APP_CACHE);
			const files = await Promise.all([...APP_URLS].map((url) => cache.match(url)));
			port.postMessage({ ready: files.every(Boolean), version: VERSION });
			return;
		}
		if (!['CHECK_UPDATE', 'APPLY_UPDATE'].includes(event.data?.type)) return;
		const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
			.filter((client) => client.url.startsWith(BASE));
		if (windows.some((client) => client.id !== event.source.id)) {
			port.postMessage({ ok: false, message: 'Close other Card Studio tabs and app windows, then try again. Their work will not be reloaded.' });
			return;
		}
		port.postMessage({ ok: true });
		if (event.data.type === 'APPLY_UPDATE') await self.skipWaiting();
	})().catch(() => port.postMessage({ ok: false, message: 'The update could not be applied. Keep working and try again later.' })));
});