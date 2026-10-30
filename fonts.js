// Font sources, loading, local persistence, and picker UI live outside the editor.
(() => {
	'use strict';
	const system = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Courier New'];
	const google = ['Roboto', 'Merriweather', 'Libre Barcode 39'];
	const legacyGoogle = [...google, 'Inter', 'Open Sans', 'Montserrat', 'Lato', 'Oswald'];
	function validName(name) {
		return typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 120 && !/[\u0000-\u001f\u007f"\\]/.test(name);
	}
	function normalize(o) {
		if (!validName(o.font)) throw Error('A font name is invalid.');
		const source = o.fontSource || (system.includes(o.font) ? 'system' : legacyGoogle.includes(o.font) ? 'google' : '');
		if (!['system', 'google', 'installed', 'file'].includes(source) || (source === 'system' && !system.includes(o.font)))
			throw Error('The layout has an unsupported font source.');
		const spec = { font: o.font, fontSource: source };
		if (source === 'file') {
			if (typeof o.fontId !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(o.fontId)) throw Error('An imported font reference is invalid.');
			spec.fontId = o.fontId;
		}
		return spec;
	}
	const key = (o) => JSON.stringify(Object.values(normalize(o)));
	function create() {
		const catalog = globalThis.CardStudioGoogleFonts || [];
		const metadata = new Map(catalog.map((f) => [f.family, f]));
		const known = new Map(), promises = new Map(), problems = new Map(), aliases = new Map();
		let database, measurementContext, sequence = 0;
		const remember = (o) => { const spec = normalize(o); known.set(key(spec), spec); return spec; };
		system.forEach((font) => remember({ font, fontSource: 'system' }));
		google.forEach((font) => remember({ font, fontSource: 'google' }));
		function alias(o) {
			if (['system', 'google'].includes(normalize(o).fontSource)) return o.font;
			const k = key(o);
			if (!aliases.has(k)) aliases.set(k, `CardStudioLocal${++sequence}`);
			return aliases.get(k);
		}
		function family(o) { return `"${alias(o)}", ${['Georgia', 'Times New Roman', 'Merriweather'].includes(o.font) ? 'serif' : o.font === 'Courier New' ? 'monospace' : 'sans-serif'}`; }
		function lineHeight(o, text, minimum = 1.15) {
			measurementContext ||= document.createElement('canvas').getContext('2d');
			if (!measurementContext) return 'normal';
			const barcode = o.font === 'Libre Barcode 39';
			// Measure at a large reference size to minimize pixel-rounding errors, then return a unitless ratio so shrink-to-fit scales the line box with the text.
			measurementContext.font = `${!barcode && o.italic ? 'italic ' : ''}${!barcode && o.bold ? 700 : 400} 1000px ${family(o)}`;
			const m = measurementContext.measureText(text || 'Mg');
			const ascent = m.fontBoundingBoxAscent, descent = m.fontBoundingBoxDescent;
			if (![ascent, descent, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].every(Number.isFinite))
				return 'normal';
			const required = Math.max(
				2 * m.actualBoundingBoxAscent - ascent + descent,
				2 * m.actualBoundingBoxDescent + ascent - descent
			);
			return Math.max(minimum, (required + 2) / 1000);
		}
		function db() {
			if (!database) database = new Promise((resolve, reject) => {
				const request = indexedDB.open('card-studio-fonts', 1);
				request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'fontId' });
				request.onsuccess = () => resolve(request.result);
				request.onerror = request.onblocked = () => reject(Error('Font storage is unavailable. Enable browser storage and try again.'));
			}).catch((error) => { database = null; throw error; });
			return database;
		}
		async function storage(action, value) {
			const database = await db();
			return new Promise((resolve, reject) => {
				const tx = database.transaction('files', action === 'put' ? 'readwrite' : 'readonly');
				const request = tx.objectStore('files')[action](value);
				let result;
				request.onsuccess = () => { result = request.result; };
				tx.oncomplete = () => resolve(result);
				tx.onerror = tx.onabort = () => reject(Error('The font could not be saved or read. Browser storage may be full or unavailable.'));
			});
		}
		function googleURL(name) {
			const variants = metadata.get(name)?.variants || [];
			const tuples = [];
			for (const italic of [false, true]) {
				const weights = variants.filter((v) => v.endsWith('i') === italic).map(parseFloat).filter(Number.isFinite);
				if (!weights.length) continue;
				for (const wanted of [400, 700]) {
					const weight = weights.reduce((a, b) => Math.abs(a - wanted) <= Math.abs(b - wanted) ? a : b);
					tuples.push(`${italic ? 1 : 0},${weight}`);
				}
			}
			const styles = [...new Set(tuples)].sort((a, b) => {
				const aa = a.split(',').map(Number), bb = b.split(',').map(Number);
				return aa[0] - bb[0] || aa[1] - bb[1];
			});
			return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}${styles.length ? ':ital,wght@' + styles.join(';') : ''}&display=swap`;
		}
		function loadGoogle(spec) {
			return new Promise((resolve, reject) => {
				const link = document.createElement('link');
				link.rel = 'stylesheet'; link.crossOrigin = 'anonymous'; link.href = googleURL(spec.font);
				let done = false;
				const finish = (error) => {
					if (done) return; done = true; clearTimeout(timer);
					if (error) { link.remove(); reject(Error(`“${spec.font}” could not load from Google Fonts. Connect to the internet to load uncached fonts, or choose a system or imported font.`)); }
					else resolve();
				};
				const timer = setTimeout(() => finish(true), 20000);
				link.onerror = () => finish(true);
				link.onload = async () => {
					try {
						const faces = [...document.fonts].filter((face) => face.family.replace(/^['"]|['"]$/g, '') === spec.font);
						if (!faces.length) throw Error('No font faces');
						const loaded = await document.fonts.load(`16px "${spec.font}"`, 'BESbswy 0123456789');
						// Some script-specific fonts have no Latin characters.
						if (!loaded.length) await faces[0].load();
						finish();
					} catch { finish(true); }
				};
				document.head.append(link);
			});
		}
		async function loadLocal(spec) {
			let source;
			if (spec.fontSource === 'file') {
				const record = await storage('get', spec.fontId);
				if (!record) throw Error(`Missing font file: “${spec.font}”. Open More fonts → Local fonts and import the same font file again.`);
				source = record.bytes;
			} else source = `local("${spec.font}")`;
			const face = new FontFace(alias(spec), source);
			try { await face.load(); document.fonts.add(face); }
			catch {
				throw Error(spec.fontSource === 'installed'
					? `“${spec.font}” is not available to this browser. Check its installed full font name, or import its font file.`
					: `“${spec.font}” could not load. Import a supported font file again.`);
			}
		}
		function ensure(o) {
			const spec = normalize(o), k = key(spec);
			if (promises.has(k)) return promises.get(k);
			const promise = (spec.fontSource === 'system' ? Promise.resolve() : spec.fontSource === 'google' ? loadGoogle(spec) : loadLocal(spec))
				.then(() => { problems.delete(k); })
				.catch((error) => { promises.delete(k); problems.set(k, error.message); throw error; });
			promises.set(k, promise); return promise;
		}
		async function loadText(o, text) {
			await ensure(o);
			if (normalize(o).fontSource === 'system' || !text) return;
			const barcode = o.font === 'Libre Barcode 39';
			await document.fonts.load(`${!barcode && o.italic ? 'italic ' : ''}${!barcode && o.bold ? 700 : 400} 16px "${alias(o)}"`, text);
		}
		async function importFile(file, label) {
			if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name)) throw Error('Choose a TTF, OTF, WOFF, or WOFF2 font file.');
			if (!file.size || file.size > 20 * 1024 * 1024) throw Error('Choose a font file between 1 byte and 20 MB.');
			if (!validName(label)) throw Error('Enter a font label of 1–120 characters, without double quotes or backslashes.');
			if (!globalThis.crypto?.subtle) throw Error('Font-file import needs HTTPS or localhost. Open the app from a secure address and try again.');
			const bytes = await file.arrayBuffer();
			const hash = await crypto.subtle.digest('SHA-256', bytes);
			const fontId = 'sha256-' + [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
			const spec = { font: label, fontSource: 'file', fontId };
			const face = new FontFace(alias(spec), bytes);
			try { await face.load(); } catch { throw Error('The browser could not read this font. Choose a valid TTF, OTF, WOFF, or WOFF2 file.'); }
			await storage('put', { ...spec, bytes });
			document.fonts.add(face);
			problems.delete(key(spec)); promises.set(key(spec), Promise.resolve());
			remember(spec);
			return spec;
		}
		function populate(select, current, objects) {
			objects.filter((o) => o.type === 'text').forEach(remember);
			select.replaceChildren();
			for (const [source, label] of Object.entries({ system: 'System fonts', google: 'Google Fonts', installed: 'Installed fonts', file: 'Imported fonts' })) {
				const group = document.createElement('optgroup'); group.label = label;
				for (const spec of known.values()) if (spec.fontSource === source) {
					const option = document.createElement('option'); option.value = key(spec); option.textContent = spec.font;
					group.append(option);
				}
				if (group.children.length) select.append(group);
			}
			select.value = key(current);
		}
		function messages(objects) {
			return [...new Set(objects.filter((o) => o.type === 'text').map((o) => problems.get(key(o))).filter(Boolean))];
		}
		function initPicker({ apply, refresh, objects }) {
			const $ = (id) => document.getElementById(id);
			let pending = null, previewSerial = 0, page = 0, busy = false;
			const setStatus = (message) => { $('fontPickerStatus').textContent = message; };
			const setBusy = (value) => {
				busy = value;
				$('fontPickerControls').disabled = value;
				$('usePickedFont').disabled = value || !pending;
			};
			async function preview(spec) {
				const serial = ++previewSerial;
				pending = null; $('usePickedFont').disabled = true;
				$('fontPreview').style.fontFamily = 'sans-serif';
				$('fontPreview').style.lineHeight = '1.4';
				$('fontPreviewName').textContent = spec.font;
				setStatus('Loading font preview…');
				try {
					await ensure(spec); await loadText(spec, $('fontPreview').textContent);
					if (serial !== previewSerial) return;
					pending = spec; $('fontPreview').style.fontFamily = family(spec);
					$('fontPreview').style.lineHeight = lineHeight(spec, $('fontPreview').textContent, 1.4);
					$('usePickedFont').disabled = false; setStatus('Ready to use.');
				} catch (error) { if (serial === previewSerial) setStatus(error.message); }
			}
			function results() {
				const query = $('googleFontSearch').value.trim().toLowerCase(), category = $('googleFontCategory').value;
				const matches = catalog.filter((f) => f.family.toLowerCase().includes(query) && (!category || category === f.category));
				page = Math.min(page, Math.max(0, Math.ceil(matches.length / 18) - 1));
				$('googleFontResults').replaceChildren();
				for (const f of matches.slice(page * 18, page * 18 + 18)) {
					const button = document.createElement('button'); button.type = 'button'; button.textContent = f.family;
					button.addEventListener('click', () => preview({ font: f.family, fontSource: 'google' }));
					$('googleFontResults').append(button);
				}
				$('googleFontCount').textContent = `${matches.length} ${matches.length === 1 ? 'family' : 'families'} · Page ${page + 1} of ${Math.max(1, Math.ceil(matches.length / 18))}`;
				$('googleFontsPrev').disabled = page === 0; $('googleFontsNext').disabled = (page + 1) * 18 >= matches.length;
			}
			$('moreFonts').addEventListener('click', () => {
				pending = null; $('usePickedFont').disabled = true;
				$('fontPreviewName').textContent = 'Font preview'; $('fontPreview').style.fontFamily = 'sans-serif';
				$('fontPreview').style.lineHeight = '1.4';
				setStatus('Choose a font to preview.');
				$('fontsDialog').showModal(); results();
				$('fontsDialog').querySelector('.font-picker-scroll').scrollTop = 0;
				($('googleFontPanel').hidden ? $('installedFontName') : $('googleFontSearch')).focus();
			});
			$('fontsDialog').addEventListener('close', () => { previewSerial++; pending = null; $('usePickedFont').disabled = true; });
			$('googleFontSearch').addEventListener('input', () => { page = 0; results(); });
			$('googleFontCategory').addEventListener('change', () => { page = 0; results(); });
			$('googleFontsPrev').addEventListener('click', () => { page--; results(); });
			$('googleFontsNext').addEventListener('click', () => { page++; results(); });
			for (const category of [...new Set(catalog.map((f) => f.category))].sort()) {
				const option = document.createElement('option'); option.value = category; option.textContent = category; $('googleFontCategory').append(option);
			}
			for (const button of document.querySelectorAll('[data-font-tab]')) button.addEventListener('click', () => {
				const local = button.dataset.fontTab === 'local';
				$('googleFontPanel').hidden = local; $('localFontPanel').hidden = !local;
				for (const tab of document.querySelectorAll('[data-font-tab]')) tab.setAttribute('aria-pressed', String(tab === button));
			});
			$('previewGoogleName').addEventListener('click', () => {
				const font = $('googleFontSearch').value.trim();
				if (!validName(font)) { setStatus('Enter a Google Fonts family name to preview.'); return; }
				preview({ font, fontSource: 'google' });
			});
			$('loadInstalledFont').addEventListener('click', () => {
				const font = $('installedFontName').value.trim();
				if (!validName(font)) { setStatus('Enter an installed font name, such as Team 401.'); return; }
				preview({ font, fontSource: 'installed' });
			});
			$('localFontFile').addEventListener('change', () => {
				const file = $('localFontFile').files[0];
				if (file) $('localFontLabel').value = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
			});
			$('importFontFile').addEventListener('click', async () => {
				if (busy) return;
				previewSerial++; pending = null; setBusy(true); setStatus('Importing font…');
				try {
					const spec = await importFile($('localFontFile').files[0], $('localFontLabel').value.trim());
					// Reload matching references too: a reopened layout may use a different display label.
					await Promise.allSettled(objects().filter((o) => o.fontSource === 'file' && o.fontId === spec.fontId).map(ensure));
					refresh(); await preview(spec);
				} catch (error) { setStatus(error.message); }
				finally { setBusy(false); }
			});
			$('usePickedFont').addEventListener('click', () => {
				if (!pending) return;
				remember(pending); apply(pending); $('fontsDialog').close();
			});
			$('fontFamily').addEventListener('change', () => {
				const spec = known.get($('fontFamily').value); if (spec) apply(spec);
			});
			storage('getAll').then((records) => { records.forEach(remember); refresh(); }).catch(() => { });
		}
		return { normalize, key, family, lineHeight, ensure, loadText, populate, messages, initPicker, importFile, googleURL };
	}
	const api = { system, google, normalize, key, create };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else globalThis.CardStudioFonts = api;
})();