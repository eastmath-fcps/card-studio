// Geometry is stored in inches. 96 CSS pixels = 1 inch; text sizes use points.
(() => {
	'use strict';
	const DPI = 96;
	const Templates = typeof module !== 'undefined' && module.exports
		? require('./templates.js') : globalThis.CardStudioTemplates;
	if (!Templates) throw Error('Paper-stock definitions could not load. Check that templates.js is beside script.js.');
	const DEFAULT_TEMPLATE = Templates.get();
	const OBJECT_LIMITS = Object.freeze({
		x: Math.max(...Object.values(Templates.geometries).map((g) => g.card.width)),
		y: Math.max(...Object.values(Templates.geometries).map((g) => g.card.height)),
	});
	const capacity = (template) => template.grid.columns * template.grid.rows;
	const dimensions = (template) => `${inchText(template.card.width)} × ${inchText(template.card.height)} in`;
	function inchText(value) {
		const fraction = { 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' }[value % 1];
		return fraction ? `${Math.floor(value) || ''}${fraction}` : String(value);
	}
	const MAX_ROWS = 10000,
		MAX_OBJECTS = 100,
		MAX_CARDS = 5000;
	const Fonts = typeof module !== 'undefined' && module.exports
		? require('./fonts.js') : globalThis.CardStudioFonts;

	const clone = (value) => JSON.parse(JSON.stringify(value));
	const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
	const round = (v, digits = 3) => Number(v.toFixed(digits));
	const uid = () =>
		globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const escapeName = (name) =>
		name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'card-layout';
	const tokens = (text) => [...text.matchAll(/<<([^<>]+)>>/g)].map((match) => match[1].trim());
	function merge(text, row) {
		return text.replace(/<<([^<>]+)>>/g, (whole, field) =>
			Object.hasOwn(row, field.trim()) ? String(row[field.trim()]) : whole
		);
	}
	function parseCSV(source) {
		source = source.replace(/^\uFEFF/, '');
		// Detect a delimiter using the first logical row, ignoring quoted content.
		const counts = { ',': 0, ';': 0, '\t': 0 };
		let inQuotes = false;
		for (let i = 0; i < source.length; i++) {
			const c = source[i];
			if (c === '"') {
				if (inQuotes && source[i + 1] === '"') i++;
				else inQuotes = !inQuotes;
			} else if (!inQuotes) {
				if (c === '\n' || c === '\r') break;
				if (Object.hasOwn(counts, c)) counts[c]++;
			}
		}
		const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
		const rows = [];
		let row = [],
			cell = '',
			quoted = false,
			closed = false;
		const pushCell = () => {
			row.push(cell);
			cell = '';
			closed = false;
			if (row.length > 250) throw Error('Please use 250 columns or fewer.');
		};
		const pushRow = () => {
			pushCell();
			rows.push(row);
			row = [];
			if (rows.length > MAX_ROWS + 2)
				throw Error(`Please import ${MAX_ROWS.toLocaleString()} records or fewer.`);
		};
		for (let i = 0; i < source.length; i++) {
			const c = source[i];
			if (quoted) {
				if (c === '"') {
					if (source[i + 1] === '"') {
						cell += '"';
						i++;
					} else {
						quoted = false;
						closed = true;
					}
				} else cell += c;
			} else if (c === delimiter) pushCell();
			else if (c === '\r' || c === '\n') {
				if (c === '\r' && source[i + 1] === '\n') i++;
				pushRow();
			} else if (c === '"' && cell === '' && !closed) quoted = true;
			else if (closed) {
				if (c !== ' ' && c !== '\t')
					throw Error(
						'CSV contains unexpected text after a closing quote. Please export it again.'
					);
			} else cell += c;
			if (cell.length > 20000)
				throw Error('A cell exceeds 20,000 characters. Check the spreadsheet before importing.');
		}
		if (quoted) throw Error('CSV contains an unclosed quotation mark. Please export it again.');
		if (cell !== '' || row.length || closed) pushRow();
		return rows;
	}
	function normalizeRows(matrix) {
		if (!matrix.length || !matrix[0].some((v) => String(v ?? '').trim()))
			throw Error('Row 1 must contain your column headings.');
		if (matrix.length > MAX_ROWS + 2)
			throw Error(`Please import ${MAX_ROWS.toLocaleString()} records or fewer.`);
		const width = Math.max(...matrix.map((row) => row.length));
		if (width > 250) throw Error('Please use 250 columns or fewer.');
		const headers = [],
			columns = [],
			notices = [],
			used = new Set();
		for (let i = 0; i < width; i++) {
			const raw = String(matrix[0][i] ?? '').trim();
			if (!raw && !matrix.slice(1).some((row) => String(row[i] ?? '').trim())) continue;
			if (raw.includes('<<') || raw.includes('>>') || raw.length > 120)
				throw Error('Column headings must be 120 characters or fewer and cannot contain << or >>.');
			const base = raw || `Column ${i + 1}`;
			let header = base,
				suffix = 2;
			while (used.has(header)) header = `${base} (${suffix++})`;
			if (!raw || header !== raw)
				notices.push(
					`Column ${i + 1} is named “${header}” because its heading was blank or duplicated.`
				);
			headers.push(header);
			columns.push(i);
			used.add(header);
		}
		const rows = matrix
			.slice(1)
			.filter((row) => row.some((v) => String(v ?? '').trim()))
			.map((row) => {
				const result = Object.create(null);
				columns.forEach((col, i) => {
					const value = String(row[col] ?? '');
					if (value.length > 20000) throw Error('A cell exceeds 20,000 characters.');
					result[headers[i]] = value;
				});
				return result;
			});
		if (rows.length > MAX_ROWS)
			throw Error(`Please import ${MAX_ROWS.toLocaleString()} records or fewer.`);
		if (!rows.length) notices.push('The headings loaded, but there are no records below them.');
		return { headers, rows, notices };
	}
	function makePlan(total, from, to, copies, skip, template = DEFAULT_TEMPLATE) {
		if (
			![total, from, to, copies, skip].every(Number.isInteger) ||
			total < 1 ||
			from < 1 ||
			to > total ||
			to < from ||
			copies < 1 ||
			copies > 100 ||
			skip < 0 ||
			skip >= capacity(template)
		)
			throw Error('Choose a valid record range, 1–100 copies, and a starting card.');
		const count = (to - from + 1) * copies;
		if (count > MAX_CARDS)
			throw Error(
				`Print up to ${MAX_CARDS.toLocaleString()} cards at a time. Choose a smaller record range.`
			);
		const slots = Array(skip).fill(null);
		for (let index = from - 1; index < to; index++)
			for (let copy = 0; copy < copies; copy++) slots.push(index);
		return { slots, count, pages: Math.ceil(slots.length / capacity(template)) };
	}
	function cardPosition(slot, offsetX = 0, offsetY = 0, template = DEFAULT_TEMPLATE) {
		const { card, grid } = template;
		return {
			x: grid.left + (slot % grid.columns) * (card.width + grid.gapX) + offsetX / 25.4,
			y: grid.top + Math.floor(slot / grid.columns) * (card.height + grid.gapY) + offsetY / 25.4,
		};
	}
	function outsideCard(o, template) {
		const { width, height, radius } = template.card;
		const b = bounds(o);
		if (b.left < -0.001 || b.top < -0.001 || b.right > width + 0.001 || b.bottom > height + 0.001)
			return true;
		if (!radius) return false;
		const angle = o.rotation * Math.PI / 180;
		// Check rounded corners when rotating.
		return [-1, 1].some((sx) => [-1, 1].some((sy) => {
			const x = o.x + o.w / 2 + sx * o.w / 2 * Math.cos(angle) - sy * o.h / 2 * Math.sin(angle);
			const y = o.y + o.h / 2 + sx * o.w / 2 * Math.sin(angle) + sy * o.h / 2 * Math.cos(angle);
			return Math.hypot(x - clamp(x, radius, width - radius), y - clamp(y, radius, height - radius)) > radius + 0.001;
		}));
	}
	function bounds(o) {
		const angle = (o.rotation * Math.PI) / 180,
			c = Math.abs(Math.cos(angle)),
			s = Math.abs(Math.sin(angle));
		const w = o.w * c + o.h * s,
			h = o.w * s + o.h * c;
		return {
			left: o.x + o.w / 2 - w / 2,
			top: o.y + o.h / 2 - h / 2,
			right: o.x + o.w / 2 + w / 2,
			bottom: o.y + o.h / 2 + h / 2,
		};
	}
	function resized(o, handle, dx, dy, lock) {
		const angle = (o.rotation * Math.PI) / 180,
			cos = Math.cos(angle),
			sin = Math.sin(angle);
		const lx = dx * cos + dy * sin,
			ly = -dx * sin + dy * cos;
		const sx = handle.includes('e') ? 1 : -1,
			sy = handle.includes('s') ? 1 : -1;
		let w = clamp(o.w + sx * lx, 0.05, OBJECT_LIMITS.x * 2),
			h = clamp(o.h + sy * ly, 0.05, OBJECT_LIMITS.y * 2);
		if (lock) {
			const scale = Math.abs(w / o.w - 1) >= Math.abs(h / o.h - 1) ? w / o.w : h / o.h;
			const safe = clamp(scale, Math.max(0.05 / o.w, 0.05 / o.h), Math.min(OBJECT_LIMITS.x * 2 / o.w, OBJECT_LIMITS.y * 2 / o.h));
			w = o.w * safe;
			h = o.h * safe;
		}
		const cx = (sx * (w - o.w)) / 2,
			cy = (sy * (h - o.h)) / 2;
		return {
			w,
			h,
			x: o.x + o.w / 2 + cx * cos - cy * sin - w / 2,
			y: o.y + o.h / 2 + cx * sin + cy * cos - h / 2,
		};
	}
	function validateLayout(payload) {
		if (!payload || payload.format !== 'card-studio-layout' || ![1, 2, 3].includes(payload.version))
			throw Error('This is not a supported Card Studio layout (version 1, 2, or 3).');
		const l = payload.layout;
		if (!l || (payload.version >= 2 && typeof l.templateId !== 'string'))
			throw Error('The layout is missing its paper-stock selection.');
		// Version 1 layouts always meant Avery 5911 - they predated other templates
		const template = Templates.get(payload.version === 1 ? Templates.defaultId : l.templateId);
		if (payload.version === 1 && l.templateId !== undefined && l.templateId !== Templates.defaultId)
			throw Error('Version 1 layouts support Avery 5911 only.');
		if (
			!l ||
			l.width !== template.card.width ||
			l.height !== template.card.height ||
			!Array.isArray(l.objects) ||
			l.objects.length > MAX_OBJECTS
		)
			throw Error(`The layout must match ${template.name} (${dimensions(template)}) with 100 objects or fewer.`);
		const color = (v) => {
			if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))
				throw Error('A layout color is invalid.');
			return v;
		};
		const number = (v, min, max) => {
			if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
				throw Error('An object has an invalid position, size, or style.');
			return v;
		};
		const str = (v, max) => {
			if (typeof v !== 'string' || v.length > max) throw Error('A layout text value is invalid.');
			return v;
		};
		const objects = l.objects.map((o, index) => {
			if (!o || !['text', 'image', 'shape'].includes(o.type))
				throw Error('Unknown object type in layout.');
			const out = {
				id: `object-${index}-${uid()}`,
				type: o.type,
				name: str(o.name, 80),
				x: number(o.x, -OBJECT_LIMITS.x, OBJECT_LIMITS.x),
				y: number(o.y, -OBJECT_LIMITS.y, OBJECT_LIMITS.y),
				w: number(o.w, 0.05, OBJECT_LIMITS.x * 2),
				h: number(o.h, 0.05, OBJECT_LIMITS.y * 2),
				rotation: number(o.rotation, -180, 180),
				opacity: number(o.opacity, 0, 1),
			};
			if (o.type === 'text') {
				if (!['left', 'center', 'right'].includes(o.align))
					throw Error('A text style is unsupported.');
				Object.assign(out, {
					text: str(o.text, 20000),
					...Fonts.normalize(o),
					fontSize: number(o.fontSize, 6, 96),
					color: color(o.color),
					align: o.align,
					bold: !!o.bold,
					italic: !!o.italic,
					underline: !!o.underline,
					autoFit: !!o.autoFit,
				});
			} else if (o.type === 'image') {
				if (
					typeof o.src !== 'string' ||
					o.src.length > 8000000 ||
					!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(o.src) ||
					!['contain', 'cover', 'fill'].includes(o.fit)
				)
					throw Error('Images must be embedded PNG, JPEG, WebP, or GIF data.');
				Object.assign(out, { src: o.src, fit: o.fit, lockAspect: !!o.lockAspect });
			} else
				Object.assign(out, {
					fill: color(o.fill),
					border: color(o.border),
					borderWidth: number(o.borderWidth, 0, 10),
				});
			return out;
		});
		return {
			templateId: template.id,
			width: template.card.width,
			height: template.card.height,
			name: str(l.name, 80) || 'Untitled layout',
			background: color(l.background),
			objects,
		};
	}
	const Core = {
		parseCSV,
		normalizeRows,
		merge,
		tokens,
		makePlan,
		cardPosition,
		bounds,
		resized,
		validateLayout,
		Templates,
		capacity,
		outsideCard,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = Core;
	if (typeof document === 'undefined') return;

	// All dataset values are rendered as textContent, never HTML.
	const $ = (id) => document.getElementById(id);
	function el(tag, cls, text) {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}
	function icon(name) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		const use = document.createElementNS(svg.namespaceURI, 'use');
		use.setAttribute('href', `#i-${name}`);
		svg.append(use);
		return svg;
	}
	const textObject = (name, text, x, y, w, h, fontSize, extra = {}) => ({
		id: uid(),
		type: 'text',
		name,
		text,
		x,
		y,
		w,
		h,
		fontSize,
		font: 'Arial',
		fontSource: 'system',
		color: '#000000',
		bold: false,
		italic: false,
		underline: false,
		align: 'left',
		rotation: 0,
		opacity: 1,
		autoFit: true,
		...extra,
	});
	const shapeObject = (name, x, y, w, h, fill) => ({
		id: uid(),
		type: 'shape',
		name,
		x,
		y,
		w,
		h,
		fill,
		border: fill,
		borderWidth: 0,
		rotation: 0,
		opacity: 1,
	});
	function starterLayout() {
		return {
			name: 'Starter card',
			templateId: Templates.defaultId,
			width: DEFAULT_TEMPLATE.card.width,
			height: DEFAULT_TEMPLATE.card.height,
			background: '#ffffff',
			objects: [
				shapeObject('Header banner', 0.125, 0.125, 3.25, 0.37, '#33465e'),
				textObject('Heading', 'ID CARD', 0.24, 0.215, 2.67, 0.15, 9, {
					color: '#ffffff',
					bold: true,
				}),
				textObject('Card label', 'Welcome,', 0.24, 0.68, 2.98, 0.15, 7, {
					color: '#6c7f96',
					bold: true,
				}),
				textObject('Name', '<<LastName>>, <<FirstName>>', 0.23, 0.94, 3.04, 0.42, 21, {
					bold: true,
				}),
				shapeObject('Divider', 0.24, 1.48, 3.02, 0.05, '#dce4ef'),
				textObject(
					'Details',
					'ID  <<RecordID>>   -   <<Category>>',
					0.24,
					1.65,
					3.02,
					0.18,
					8,
					{ color: '#516985' }
				),
			],
		};
	}
	const sampleMatrix = [
		[
			"FirstName",
			"LastName",
			"RecordID",
			"Category",
			"Location",
			"Reference"
		],
		[
			"William",
			"Hartnell",
			"19631123",
			"Doctor",
			"TARDIS",
			"1"
		],
		[
			"Jon",
			"Pertwee",
			"19700103",
			"Doctor",
			"TARDIS",
			"3"
		],
		[
			"Tom",
			"Baker",
			"19741228",
			"Doctor",
			"TARDIS",
			"4"
		],
		[
			"Peter",
			"Davidson",
			"19820104",
			"Doctor",
			"TARDIS",
			"5"
		],
		[
			"Baker",
			"Colin",
			"19840322",
			"Doctor",
			"TARDIS",
			"6"
		],
		[
			"Sylvester",
			"McCoy",
			"19870907",
			"Doctor",
			"TARDIS",
			"7"
		],
		[
			"Christopher",
			"Eccleston",
			"20050326",
			"Doctor",
			"TARDIS",
			"9"
		],
		[
			"David",
			"Tennant",
			"20051225",
			"Doctor",
			"TARDIS",
			"10"
		],
		[
			"Matt",
			"Smith",
			"20100403",
			"Doctor",
			"TARDIS",
			"11"
		],
		[
			"Peter",
			"Capaldi",
			"20140823",
			"Doctor",
			"TARDIS",
			"12"
		],
		[
			"Jodie",
			"Whittaker",
			"20181007",
			"Doctor",
			"TARDIS",
			"13"
		],
		[
			"Ncuti",
			"Gatwa",
			"20231225",
			"Doctor",
			"TARDIS",
			"15"
		]
	];
	const state = {
		layout: starterLayout(),
		layoutId: null,
		savedFingerprint: null,
		dirty: false,
		selected: null,
		headers: [],
		rows: [],
		sample: true,
		source: '',
		workbook: null,
		sheetName: '',
		record: 0,
		dataPage: 0,
		view: 'design',
		history: [],
		historyIndex: 0,
		zoom: 1,
		plan: null,
		printPage: 0,
		printReady: false,
		printBusy: false,
	};
	let toastTimer,
		imageReplacement = null,
		saving = false,
		textSelection = { start: 0, end: 0 },
		workbookFileName = '',
		dataImportSerial = 0;

	const currentTemplate = () => Templates.get(state.layout.templateId);
	let displayedTemplateId = null;
	function syncTemplateUI() {
		const template = currentTemplate();
		if (displayedTemplateId === template.id) return;
		const previous = displayedTemplateId ? Templates.get(displayedTemplateId) : null;
		displayedTemplateId = template.id;
		const style = document.documentElement.style;
		for (const [name, value] of Object.entries({
			'card-width': template.card.width, 'card-height': template.card.height,
			'sheet-width': template.page.width, 'sheet-height': template.page.height,
			'corner-radius': template.card.radius, 'safe-inset': template.safeInset,
			'safe-radius': Math.max(0, template.card.radius - template.safeInset),
		})) style.setProperty(`--${name}`, `${value}in`);
		$('pageSizeStyle').textContent = `@page { size: ${template.page.width}in ${template.page.height}in; margin: 0; }`;
		for (const id of ['paperStock', 'printPaperStock']) $(id).value = template.id;
		$('stockName').textContent = template.name.toUpperCase();
		$('stockSummary').textContent = `${dimensions(template)} - ${capacity(template)} per sheet`;
		$('stockDescription').textContent = `${template.description}. ${dimensions(template)} - ${capacity(template)} per sheet.`;
		$('printStockSummary').textContent = `${template.page.name} - ${capacity(template)} per sheet - ${dimensions(template)}`;
		$('canvasMeasure').textContent = dimensions(template);
		$('safeGuideCaption').textContent = `Dashed line = ${inchText(template.safeInset)}-inch safe area - does not print`;
		$('printPaperInstructions').textContent = `${template.page.name} paper - ${template.page.orientation} - 100% scale`;
		const oldSlot = Number($('startSlot').value) || 0;
		$('startSlot').replaceChildren(...Array.from({ length: capacity(template) }, (_, slot) => {
			const option = el('option', '', `Card ${slot + 1} - row ${Math.floor(slot / template.grid.columns) + 1}, column ${slot % template.grid.columns + 1}`);
			option.value = slot;
			return option;
		}));
		$('startSlot').value = String(Math.min(oldSlot, capacity(template) - 1));
		if (previous && previous.geometryId !== template.geometryId) {
			// Printer calibration and a partially used sheet belong to that physical stock.
			$('offsetX').value = $('offsetY').value = $('startSlot').value = '0';
		}
		state.printPage = 0;
		$('printStatus').textContent = '';
		for (const [id, min, max] of [
			['posX', -OBJECT_LIMITS.x, OBJECT_LIMITS.x], ['posY', -OBJECT_LIMITS.y, OBJECT_LIMITS.y],
			['objWidth', 0.05, OBJECT_LIMITS.x * 2], ['objHeight', 0.05, OBJECT_LIMITS.y * 2],
		]) { $(id).min = min; $(id).max = max; }
	}
	function changeTemplate(id) {
		if (id === state.layout.templateId) return;
		const template = Templates.get(id);
		state.layout.templateId = id;
		state.layout.width = template.card.width;
		state.layout.height = template.card.height;
		checkpoint();
		renderDesign();
		if (state.view === 'print') updateSheetPreview();
		notify(`${template.name} selected. Objects kept their size and position. Check the design and run an alignment test.`);
	}

	function notify(message, duration = 4800) {
		$('toast').textContent = message;
		$('toast').hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			$('toast').hidden = true;
		}, duration);
	}
	function showMessage(id, message) {
		$(id).textContent = message;
		$(id).hidden = !message;
	}
	function fingerprint() {
		return JSON.stringify(state.layout);
	}
	function selected() {
		return state.layout.objects.find((o) => o.id === state.selected);
	}
	function markChanged() {
		state.dirty = fingerprint() !== state.savedFingerprint;
		$('saveState').textContent = state.dirty ? 'Unsaved changes' : 'Saved in this browser';
		$('saveState').classList.toggle('dirty', state.dirty);
		state.printReady = false;
		$('printRoot').replaceChildren();
	}
	function checkpoint() {
		const json = fingerprint();
		if (state.history[state.historyIndex] !== json) {
			state.history = state.history.slice(0, state.historyIndex + 1);
			state.history.push(json);
			if (state.history.length > 80) state.history.shift();
			state.historyIndex = state.history.length - 1;
		}
		markChanged();
		updateUndo();
	}
	function updateUndo() {
		$('undo').disabled = state.historyIndex <= 0;
		$('redo').disabled = state.historyIndex >= state.history.length - 1;
	}
	function undo(delta) {
		const next = state.historyIndex + delta;
		if (next < 0 || next >= state.history.length) return;
		state.historyIndex = next;
		state.layout = JSON.parse(state.history[next]);
		if (!selected()) state.selected = null;
		$('layoutName').value = state.layout.name;
		markChanged();
		renderDesign();
		if (state.view === 'print') updateSheetPreview();
		updateUndo();
	}
	function refreshSelection() {
		const o = selected(),
			box = $('selectionBox');
		box.hidden = !o;
		if (o) setGeometry(box, o);
		$('cardArtwork')
			.querySelectorAll('.card-object')
			.forEach((n) => n.classList.toggle('selected', n.dataset.id === state.selected));
	}
	function setGeometry(n, o) {
		Object.assign(n.style, {
			left: `${o.x * DPI}px`,
			top: `${o.y * DPI}px`,
			width: `${o.w * DPI}px`,
			height: `${o.h * DPI}px`,
			transform: `rotate(${o.rotation}deg)`,
		});
	}
	function renderObject(o, row, merged, editing = false) {
		const n = el('div', 'card-object');
		n.dataset.id = o.id;
		setGeometry(n, o);
		n.style.opacity = o.opacity;
		const content = el('div', 'object-content');
		n.append(content);
		if (o.type === 'text') {
			const inner = el('div', 'text-inner', merged && row ? merge(o.text, row) : o.text);
			Object.assign(inner.style, {
				fontFamily: fontManager.family(o),
				lineHeight: fontManager.lineHeight(o, inner.textContent),
				fontSize: `${o.fontSize}pt`,
				color: o.color,
				fontWeight: o.font !== 'Libre Barcode 39' && o.bold ? '700' : '400',
				fontStyle: o.font !== 'Libre Barcode 39' && o.italic ? 'italic' : 'normal',
				textDecoration: o.font !== 'Libre Barcode 39' && o.underline ? 'underline' : 'none',
				textAlign: o.align,
			});
			content.append(inner);
		} else if (o.type === 'image') {
			const img = el('img');
			img.src = o.src;
			img.alt = o.name;
			img.draggable = false;
			img.style.objectFit = o.fit;
			content.append(img);
		} else {
			content.style.backgroundColor = o.fill;
			content.style.border = `${o.borderWidth}pt solid ${o.border}`;
		}
		if (editing) {
			n.setAttribute('aria-label', o.name);
			n.title = o.name;
		}
		return n;
	}
	function fitText(n, o) {
		if (o.type !== 'text') return true;
		const inner = n.querySelector('.text-inner'),
			content = n.firstElementChild;
		const fits = () =>
			inner.scrollHeight <= content.clientHeight + 1 &&
			inner.scrollWidth <= content.clientWidth + 1;
		inner.style.fontSize = `${o.fontSize}pt`;
		if (!fits() && o.autoFit) {
			let low = 6,
				high = o.fontSize;
			inner.style.fontSize = '6pt';
			if (fits()) {
				for (let i = 0; i < 11; i++) {
					const mid = (low + high) / 2;
					inner.style.fontSize = `${mid}pt`;
					if (fits()) low = mid;
					else high = mid;
				}
				inner.style.fontSize = `${Math.floor(low * 100) / 100}pt`;
			}
		}
		const result = fits();
		n.classList.toggle('overflow', !result);
		return result;
	}
	function renderArtwork(container, row, merged = true, editing = false) {
		container.style.backgroundColor = state.layout.background;
		container.replaceChildren(
			...state.layout.objects.map((o) => renderObject(o, row, merged, editing))
		);
		[...container.children].forEach((n, i) => fitText(n, state.layout.objects[i]));
	}
	function renderCanvas() {
		$('cardCanvas').style.backgroundColor = state.layout.background;
		renderArtwork($('cardArtwork'), state.rows[state.record], $('mergePreview').checked, true);
		$('safeGuide').hidden = !$('showGuides').checked;
		refreshSelection();
		updateRecordControls();
		designWarnings();
	}
	function renderLayers() {
		$('layers').replaceChildren();
		[...state.layout.objects].reverse().forEach((o) => {
			const btn = el('button', `layer${o.id === state.selected ? ' active' : ''}`);
			btn.append(icon(o.type === 'shape' ? 'card' : o.type), el('span', '', o.name || o.type));
			btn.setAttribute('aria-pressed', String(o.id === state.selected));
			btn.addEventListener('click', () => selectObject(o.id));
			$('layers').append(btn);
		});
		$('layerCount').textContent = state.layout.objects.length;
	}
	function renderInspector() {
		const o = selected();
		$('emptyInspector').hidden = !!o;
		$('objectInspector').hidden = !o;
		$('inspectorTitle').textContent = o
			? `${o.type[0].toUpperCase()}${o.type.slice(1)} properties`
			: 'Card settings';
		$('objectType').textContent = o?.type.toUpperCase() || 'PAGE';
		$('cardBackground').value = state.layout.background;
		if (!o) return;
		$('textProperties').hidden = o.type !== 'text';
		$('imageProperties').hidden = o.type !== 'image';
		$('shapeProperties').hidden = o.type !== 'shape';
		$('objectName').value = o.name;
		for (const [id, key] of [
			['posX', 'x'],
			['posY', 'y'],
			['objWidth', 'w'],
			['objHeight', 'h'],
			['objRotation', 'rotation'],
		])
			$(id).value = round(o[key], key === 'rotation' ? 1 : 3);
		$('objOpacity').value = Math.round(o.opacity * 100);
		if (o.type === 'text') {
			$('textContent').value = o.text;
			fontManager.populate($('fontFamily'), o, state.layout.objects);
			showMessage('fontStatus', fontManager.messages([o]).join(' '));
			$('barcodeHint').hidden = o.font !== 'Libre Barcode 39';
			$('fontSize').value = o.fontSize;
			$('textColor').value = o.color;
			$('textAlign').value = o.align;
			$('autoFit').checked = o.autoFit;
			for (const k of ['bold', 'italic', 'underline']) {
				$(k).disabled = o.font === 'Libre Barcode 39';
				$(k).setAttribute('aria-pressed', String(o.font !== 'Libre Barcode 39' && o[k]));
			}
			textSelection = { start: o.text.length, end: o.text.length };
		} else if (o.type === 'image') {
			$('imageFit').value = o.fit;
			$('lockAspect').checked = o.lockAspect;
		} else {
			$('shapeFill').value = o.fill;
			$('shapeBorder').value = o.border;
			$('borderWidth').value = o.borderWidth;
		}
		const index = state.layout.objects.indexOf(o);
		$('sendBackward').disabled = index === 0;
		$('bringForward').disabled = index === state.layout.objects.length - 1;
	}
	function renderDesign() {
		syncTemplateUI();
		renderCanvas();
		renderLayers();
		renderInspector();
		resizeCanvas();
	}
	function selectObject(id) {
		state.selected = id;
		refreshSelection();
		renderLayers();
		renderInspector();
	}
	function resizeCanvas() {
		if (state.view !== 'design') return;
		const available = Math.max(200, $('canvasArea').clientWidth - 76),
			requested = $('zoom').value;
		state.zoom =
			requested === 'fit' ? Math.min(2.25, available / (state.layout.width * DPI)) : Number(requested);
		$('cardCanvas').style.transform = `scale(${state.zoom})`;
		$('canvasFrame').style.width = `${state.layout.width * DPI * state.zoom}px`;
		$('canvasFrame').style.height = `${state.layout.height * DPI * state.zoom}px`;
		$('canvasFrame').style.borderRadius = `${currentTemplate().card.radius * DPI * state.zoom}px`;
	}
	function missingFields() {
		const set = new Set(state.headers);
		return [
			...new Set(
				state.layout.objects
					.filter((o) => o.type === 'text')
					.flatMap((o) => tokens(o.text))
					.filter((name) => !set.has(name))
			),
		];
	}
	function designWarnings() {
		const messages = fontManager.messages(state.layout.objects),
			missing = missingFields();
		if (missing.length)
			messages.push(
				`Missing merge fields: ${missing.join(', ')}. Import matching headings or edit the placeholders.`
			);
		const clipped = state.layout.objects.filter((o) => outsideCard(o, currentTemplate()));
		if (clipped.length)
			messages.push(`${clipped.length} object(s) extend beyond the card outline and may be clipped. Check the edges before printing.`);
		if ($('cardArtwork').querySelector('.overflow'))
			messages.push(
				'Some text does not fit. Enlarge the text box, reduce the font size, or turn on “Shrink text to fit”.'
			);
		showMessage('designWarnings', messages.join(' '));
	}
	function updateRecordControls() {
		const count = state.rows.length;
		$('recordIndex').value = count ? state.record + 1 : 0;
		$('recordIndex').max = count || 1;
		$('recordIndex').disabled = !count;
		$('recordTotal').textContent = `/ ${count}`;
		$('prevRecord').disabled = !count || state.record <= 0;
		$('nextRecord').disabled = !count || state.record >= count - 1;
		const row = state.rows[state.record];
		$('recordLabel').textContent = state.sample
			? 'Sample record'
			: row
				? state.headers
					.slice(0, 2)
					.map((h) => row[h])
					.join(' ')
				: 'No records';
	}
	function setRecord(index) {
		state.record = clamp(Math.trunc(index) || 0, 0, Math.max(0, state.rows.length - 1));
		renderCanvas();
		ensureAllFonts().then(renderCanvas).catch((error) => notify(error.message));
	}
	function addObject(o) {
		if (state.layout.objects.length >= MAX_OBJECTS) {
			notify('A card can contain up to 100 objects.');
			return;
		}
		state.layout.objects.push(o);
		state.selected = o.id;
		checkpoint();
		renderDesign();
	}
	// Handle new element geometry and existing geometry when switching layouts
	function fitAndAddObject(o) {
		const { card, safeInset } = currentTemplate();
		const maxW = card.width - 2 * safeInset, maxH = card.height - 2 * safeInset;
		const scale = o.type === 'image' ? Math.min(1, maxW / o.w, maxH / o.h) : 1;
		o.w = clamp(o.w * scale, 0.05, maxW);
		o.h = clamp(o.h * scale, 0.05, maxH);
		o.x = clamp(o.x, safeInset, card.width - safeInset - o.w);
		o.y = clamp(o.y, safeInset, card.height - safeInset - o.h);
		addObject(o);
	}
	function insertField(name) {
		let o = selected();
		if (!o || o.type !== 'text') {
			fitAndAddObject(textObject(name, `<<${name}>>`, 0.25, 0.8, 3, 0.4, 18));
			return;
		}
		const input = $('textContent');
		const start = Math.min(textSelection.start, o.text.length),
			end = Math.min(textSelection.end, o.text.length);
		o.text = o.text.slice(0, start) + `<<${name}>>` + o.text.slice(end);
		checkpoint();
		renderCanvas();
		renderInspector();
		const cursor = start + name.length + 4;
		input.focus();
		input.setSelectionRange(cursor, cursor);
		textSelection = { start: cursor, end: cursor };
	}
	function removeObject() {
		if (!selected()) return;
		state.layout.objects = state.layout.objects.filter((o) => o.id !== state.selected);
		state.selected = null;
		checkpoint();
		renderDesign();
	}
	function duplicateObject() {
		const o = selected();
		if (!o) return;
		addObject({
			...clone(o),
			id: uid(),
			name: `${o.name.slice(0, 73)} copy`,
			x: clamp(o.x + 0.08, -OBJECT_LIMITS.x, OBJECT_LIMITS.x),
			y: clamp(o.y + 0.08, -OBJECT_LIMITS.y, OBJECT_LIMITS.y),
		});
	}
	function moveLayer(delta) {
		const o = selected(),
			index = state.layout.objects.indexOf(o),
			next = index + delta;
		if (!o || next < 0 || next >= state.layout.objects.length) return;
		[state.layout.objects[index], state.layout.objects[next]] = [
			state.layout.objects[next],
			state.layout.objects[index],
		];
		checkpoint();
		renderDesign();
	}

	// Pointer transforms are computed in the object's local axes. The opposite corner stays fixed when resizing even after rotation.
	let drag = null;
	$('cardCanvas').addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		const handle = e.target.closest('[data-handle]')?.dataset.handle;
		const target = e.target.closest('.card-object');
		if (!handle && !target) {
			selectObject(null);
			return;
		}
		if (target) selectObject(target.dataset.id);
		const o = selected();
		if (!o) return;
		e.preventDefault();
		$('cardCanvas').focus({ preventScroll: true });
		const rect = $('cardCanvas').getBoundingClientRect(),
			cx = rect.left + (o.x + o.w / 2) * DPI * state.zoom,
			cy = rect.top + (o.y + o.h / 2) * DPI * state.zoom;
		drag = {
			id: e.pointerId,
			mode: handle || 'move',
			before: clone(o),
			startX: e.clientX,
			startY: e.clientY,
			cx,
			cy,
			angle: Math.atan2(e.clientY - cy, e.clientX - cx),
		};
		$('cardCanvas').setPointerCapture(e.pointerId);
	});
	$('cardCanvas').addEventListener('pointermove', (e) => {
		if (!drag || e.pointerId !== drag.id) return;
		const o = selected(),
			b = drag.before,
			factor = DPI * state.zoom,
			dx = (e.clientX - drag.startX) / factor,
			dy = (e.clientY - drag.startY) / factor;
		if (!o) return;
		if (drag.mode === 'move') {
			const step = $('snapGrid').checked && !e.altKey ? 0.025 : 0.001;
			o.x = clamp(round(Math.round((b.x + dx) / step) * step), -OBJECT_LIMITS.x, OBJECT_LIMITS.x);
			o.y = clamp(round(Math.round((b.y + dy) / step) * step), -OBJECT_LIMITS.y, OBJECT_LIMITS.y);
		} else if (drag.mode === 'rotate') {
			let degrees =
				b.rotation +
				((Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) - drag.angle) * 180) / Math.PI;
			if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
			o.rotation = round(((((degrees + 180) % 360) + 360) % 360) - 180, 1);
		} else {
			Object.assign(
				o,
				resized(b, drag.mode, dx, dy, (o.type === 'image' && o.lockAspect) || e.shiftKey)
			);
			o.x = clamp(o.x, -OBJECT_LIMITS.x, OBJECT_LIMITS.x);
			o.y = clamp(o.y, -OBJECT_LIMITS.y, OBJECT_LIMITS.y);
		}
		renderCanvas();
		renderInspector();
	});
	function finishDrag(e) {
		if (!drag || (e && e.pointerId !== drag.id)) return;
		drag = null;
		checkpoint();
		renderDesign();
	}
	$('cardCanvas').addEventListener('pointerup', finishDrag);
	$('cardCanvas').addEventListener('pointercancel', (e) => {
		if (drag) {
			Object.assign(selected(), drag.before);
			drag = null;
			renderDesign();
		}
	});
	$('cardCanvas').addEventListener('lostpointercapture', finishDrag);

	function bindProperty(id, key, type = 'string', options = {}) {
		const node = $(id);
		node.addEventListener('change', () => {
			const o = selected();
			if (!o) return;
			let value =
				type === 'boolean' ? node.checked : type === 'number' ? Number(node.value) : node.value;
			if (type === 'number') {
				if (node.value === '' || !Number.isFinite(value)) {
					renderInspector();
					return;
				}
				value = clamp(value, options.min ?? -Infinity, options.max ?? Infinity);
			}
			if (key === 'w' || key === 'h') {
				if (o.type === 'image' && o.lockAspect) {
					const ratio = o.w / o.h;
					if (key === 'w') {
						value = clamp(value, Math.max(0.05, 0.05 * ratio), Math.min(OBJECT_LIMITS.x * 2, OBJECT_LIMITS.y * 2 * ratio));
						o.h = value / ratio;
					} else {
						value = clamp(value, Math.max(0.05, 0.05 / ratio), Math.min(OBJECT_LIMITS.y * 2, OBJECT_LIMITS.x * 2 / ratio));
						o.w = value * ratio;
					}
				}
			}
			o[key] = options.scale ? value * options.scale : value;
			checkpoint();
			renderDesign();
		});
	}
	for (const [id, key, min, max] of [
		['posX', 'x', -OBJECT_LIMITS.x, OBJECT_LIMITS.x],
		['posY', 'y', -OBJECT_LIMITS.y, OBJECT_LIMITS.y],
		['objWidth', 'w', 0.05, OBJECT_LIMITS.x * 2],
		['objHeight', 'h', 0.05, OBJECT_LIMITS.y * 2],
		['objRotation', 'rotation', -180, 180],
		['fontSize', 'fontSize', 6, 96],
		['borderWidth', 'borderWidth', 0, 10],
	])
		bindProperty(id, key, 'number', { min, max });
	bindProperty('objOpacity', 'opacity', 'number', { min: 0, max: 100, scale: 0.01 });
	for (const [id, key] of [
		['objectName', 'name'],
		['textColor', 'color'],
		['textAlign', 'align'],
		['imageFit', 'fit'],
		['shapeFill', 'fill'],
		['shapeBorder', 'border'],
	])
		bindProperty(id, key);
	for (const [id, key] of [
		['autoFit', 'autoFit'],
		['lockAspect', 'lockAspect'],
	])
		bindProperty(id, key, 'boolean');
	$('textContent').addEventListener('input', () => {
		const o = selected();
		if (o?.type !== 'text') return;
		o.text = $('textContent').value.slice(0, 20000);
		markChanged();
		renderCanvas();
	});
	$('textContent').addEventListener('change', checkpoint);
	for (const event of ['keyup', 'click', 'select', 'blur'])
		$('textContent').addEventListener(event, () => {
			textSelection = {
				start: $('textContent').selectionStart,
				end: $('textContent').selectionEnd,
			};
		});
	for (const key of ['bold', 'italic', 'underline'])
		$(key).addEventListener('click', () => {
			const o = selected();
			if (!o || o.type !== 'text') return;
			o[key] = !o[key];
			checkpoint();
			renderDesign();
		});
	$('cardBackground').addEventListener('change', () => {
		state.layout.background = $('cardBackground').value;
		checkpoint();
		renderCanvas();
	});
	$('centerH').addEventListener('click', () => {
		const o = selected();
		if (o) {
			o.x = (state.layout.width - o.w) / 2;
			checkpoint();
			renderDesign();
		}
	});
	$('centerV').addEventListener('click', () => {
		const o = selected();
		if (o) {
			o.y = (state.layout.height - o.h) / 2;
			checkpoint();
			renderDesign();
		}
	});

	const fontManager = Fonts.create();
	async function ensureAllFonts() {
		const results = await Promise.allSettled(state.layout.objects.filter((o) => o.type === 'text').map(
			(o) => fontManager.loadText(o, merge(o.text, state.rows[state.record] || {}))
		));
		const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
		designWarnings();
		if (selected()?.type === 'text') showMessage('fontStatus', fontManager.messages([selected()]).join(' '));
		if (errors.length) throw Error([...new Set(errors)].join(' '));
		await document.fonts.ready;
	}
	function applyFont(spec) {
		const o = selected();
		if (!o || o.type !== 'text') return;
		delete o.fontId;
		Object.assign(o, Fonts.normalize(spec));
		checkpoint();
		renderDesign();
		ensureAllFonts().then(renderCanvas).catch((error) => notify(error.message, 8000));
	}

	async function importImage(file) {
		if (!file) return;
		const replacementId = imageReplacement;
		imageReplacement = null;
		if (file.size > 10 * 1024 * 1024) throw Error('Choose an image under 10 MB.');
		if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type))
			throw Error('Choose a PNG, JPEG, WebP, GIF, or SVG image.');
		const url = URL.createObjectURL(file),
			img = new Image();
		try {
			img.src = url;
			await img.decode();
			if (
				!img.naturalWidth ||
				!img.naturalHeight ||
				img.naturalWidth * img.naturalHeight > 60000000
			)
				throw Error('This image is too large. Resize it below 60 megapixels first.');
			// Rasterize SVGs and GIFs (first frame) and normalize image orientation. Exported layouts contain self-contained PNG/JPEG pixels, never SVG code.
			const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)),
				canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
			canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
			canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
			const src = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
			if (src.length > 8000000)
				throw Error('The embedded image is too large. Try a smaller image.');
			const old = state.layout.objects.find((o) => o.id === replacementId);
			if (old?.type === 'image') {
				old.src = src;
				checkpoint();
				renderDesign();
				return;
			}
			const ratio = canvas.width / canvas.height,
				w = Math.min(1.2, 1.1 * ratio),
				h = w / ratio;
			fitAndAddObject({
				id: uid(),
				type: 'image',
				name: file.name.slice(0, 80),
				src,
				fit: 'contain',
				lockAspect: true,
				x: 0.25,
				y: 0.45,
				w: Math.max(0.05, w),
				h: Math.max(0.05, h),
				rotation: 0,
				opacity: 1,
			});
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	let xlsxPromise;
	function loadScript(src, timeoutMs = 12000) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			let complete = false;
			const finish = (error) => {
				if (complete) return;
				complete = true;
				clearTimeout(timer);
				s.onload = s.onerror = null;
				if (error) {
					s.remove();
					reject(error);
				} else resolve();
			};
			const timer = setTimeout(
				() => finish(Error('The Excel reader took too long to load.')),
				timeoutMs
			);
			s.onload = () => finish();
			s.onerror = () => finish(Error('The Excel reader could not load.'));
			document.head.append(s);
		});
	}
	function ensureXLSX() {
		if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
		if (xlsxPromise) return xlsxPromise;
		xlsxPromise = (async () => {
			try {
				await loadScript('vendor/xlsx.full.min.js', 2500);
			} catch {
				await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
			}
			if (!globalThis.XLSX) throw Error('The Excel reader did not initialize.');
			return globalThis.XLSX;
		})().catch(() => {
			xlsxPromise = null;
			throw Error(
				'Excel import could not load SheetJS. Your network may block its CDN. Try CSV, or use the local-library setup in README.md.'
			);
		});
		return xlsxPromise;
	}
	function readWorksheet(workbook, name) {
		const sheet = workbook.Sheets[name];
		if (!sheet?.['!ref'])
			throw Error('This worksheet is empty. Choose one with headings in row 1.');
		const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
		if (range.e.c >= 250 || range.e.r > MAX_ROWS + 1)
			throw Error(
				'This worksheet exceeds 250 columns or 10,000 records. Remove unused formatted rows/columns or use a smaller sheet.'
			);
		range.s = { r: 0, c: 0 };
		return normalizeRows(
			XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true, range })
		);
	}
	async function importData(file) {
		if (!file) return;
		const serial = ++dataImportSerial;
		if (file.size > 20 * 1024 * 1024) throw Error('Choose a spreadsheet under 20 MB.');
		const ext = file.name.split('.').pop().toLowerCase();
		if (!['csv', 'xls', 'xlsx'].includes(ext)) throw Error('Choose a CSV, XLS, or XLSX file.');
		$('chooseData').disabled = true;
		showMessage('dataMessage', `Reading ${file.name}…`);
		try {
			let result,
				workbook = null,
				name = '';
			if (ext === 'csv') {
				const buffer = await file.arrayBuffer(),
					bytes = new Uint8Array(buffer);
				let encoding = 'utf-8';
				if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
				else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
				let source;
				try {
					source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
				} catch {
					throw Error(
						'This CSV encoding is not UTF-8 or UTF-16. In Excel, use “CSV UTF-8” and import it again.'
					);
				}
				result = normalizeRows(parseCSV(source));
			} else {
				const reader = await ensureXLSX(),
					buffer = await file.arrayBuffer();
				workbook = reader.read(buffer, {
					type: 'array',
					cellText: true,
					cellDates: false,
					sheetRows: MAX_ROWS + 2,
				});
				if (!workbook.SheetNames.length) throw Error('This workbook has no worksheets.');
				// Prefer the first nonempty sheet; users can select any worksheet below.
				name =
					workbook.SheetNames.find((n) => workbook.Sheets[n]?.['!ref']) || workbook.SheetNames[0];
				try {
					result = readWorksheet(workbook, name);
				} catch (error) {
					// Keep the workbook selectable even if its first sheet is unsuitable.
					if (serial !== dataImportSerial) return;
					state.workbook = workbook;
					workbookFileName = file.name;
					state.sheetName = name;
					populateSheets();
					showMessage(
						'dataMessage',
						`${error.message} Select another worksheet below. Your previous records are still loaded.`
					);
					return;
				}
			}
			if (serial !== dataImportSerial) return;
			state.workbook = workbook;
			workbookFileName = file.name;
			state.sheetName = name;
			applyData(result, file.name, false);
			populateSheets();
			showMessage('dataMessage', result.notices.join(' '));
			notify(`${state.rows.length.toLocaleString()} records imported.`);
		} finally {
			$('chooseData').disabled = false;
		}
	}
	function populateSheets() {
		$('sheetLabel').hidden = !state.workbook;
		$('sheetSelect').replaceChildren();
		if (state.workbook)
			for (const name of state.workbook.SheetNames) {
				const op = el('option', '', name);
				op.value = name;
				$('sheetSelect').append(op);
			}
		$('sheetSelect').value = state.sheetName;
	}
	function applyData(result, source, sample) {
		state.headers = result.headers;
		state.rows = result.rows;
		state.source = source;
		state.sample = sample;
		state.record = 0;
		state.dataPage = 0;
		state.printPage = 0;
		state.printReady = false;
		$('printRoot').replaceChildren();
		$('printFrom').value = 1;
		$('printTo').value = state.rows.length || 1;
		$('printFrom').max = $('printTo').max = state.rows.length || 1;
		$('fieldChips').replaceChildren();
		state.headers.forEach((h) => {
			const b = el('button', '', h);
			b.title = `Insert <<${h}>>`;
			b.addEventListener('click', () => insertField(h));
			$('fieldChips').append(b);
		});
		if (!state.headers.length)
			$('fieldChips').append(el('p', 'muted small', 'Import a spreadsheet to add merge fields.'));
		$('dataBadge').textContent = sample ? 'Sample' : `${state.rows.length.toLocaleString()} rows`;
		$('sourceCaption').textContent = `${source} - ${state.rows.length.toLocaleString()} records`;
		renderDataTable();
		renderCanvas();
		if (state.view === 'print') updateSheetPreview();
	}
	function loadSample() {
		dataImportSerial++;
		state.workbook = null;
		state.sheetName = '';
		applyData(normalizeRows(sampleMatrix), 'Sample records', true);
		populateSheets();
		showMessage(
			'dataMessage',
			'These are fictional sample records. Import your spreadsheet to replace them.'
		);
	}
	function renderDataTable() {
		$('dataTitle').textContent = state.source || 'No spreadsheet loaded';
		$('dataSummary').textContent =
			`${state.rows.length.toLocaleString()} records - ${state.headers.length} merge fields${state.workbook && state.sheetName ? ` - ${state.sheetName}` : ''}`;
		const head = el('tr');
		head.append(el('th', '', '#'));
		state.headers.forEach((h) => head.append(el('th', '', h)));
		$('dataTable').tHead.replaceChildren(head);
		const body = $('dataTable').tBodies[0];
		body.replaceChildren();
		const start = state.dataPage * 50,
			end = Math.min(start + 50, state.rows.length);
		for (let i = start; i < end; i++) {
			const tr = el('tr');
			tr.append(el('td', '', i + 1));
			for (const h of state.headers) tr.append(el('td', '', state.rows[i][h]));
			body.append(tr);
		}
		$('dataPageSummary').textContent = state.rows.length
			? `Showing ${start + 1}–${end} of ${state.rows.length.toLocaleString()} records`
			: 'No records loaded';
		$('prevDataPage').disabled = state.dataPage <= 0;
		$('nextDataPage').disabled = end >= state.rows.length;
		$('clearData').disabled = !state.rows.length && !state.headers.length;
	}

	// Named designs use IndexedDB so embedded logos need not fit a small localStorage quota. The workbook and merged rows are never persisted.
	let dbPromise;
	function getDB() {
		if (!dbPromise)
			dbPromise = new Promise((resolve, reject) => {
				const request = indexedDB.open('card-studio', 1);
				request.onupgradeneeded = () => {
					request.result.createObjectStore('layouts', { keyPath: 'id' });
				};
				request.onsuccess = () => {
					request.result.onversionchange = () => request.result.close();
					resolve(request.result);
				};
				request.onerror = () => {
					dbPromise = null;
					reject(Error('Browser storage is unavailable. Export your layout to keep a copy.'));
				};
				request.onblocked = () => {
					dbPromise = null;
					reject(Error('Close other Card Studio tabs and try again.'));
				};
			});
		return dbPromise;
	}
	async function storage(action, value) {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				'layouts',
				action === 'getAll' || action === 'get' ? 'readonly' : 'readwrite'
			),
				store = transaction.objectStore('layouts');
			const request = action === 'getAll' ? store.getAll() : store[action](value);
			let result;
			request.onsuccess = () => {
				result = request.result;
			};
			transaction.oncomplete = () => resolve(result);
			transaction.onerror = transaction.onabort = () =>
				reject(
					Error(
						'The layout could not be saved or opened. Browser storage may be full or unavailable. Export a backup.'
					)
				);
		});
	}
	function payload(layout = state.layout) {
		return { format: 'card-studio-layout', version: 3, layout: clone(layout) };
	}
	async function saveLayout(copy = false) {
		if (saving) return;
		saving = true;
		$('saveLayout').disabled = $('saveCopy').disabled = true;
		try {
			const before = fingerprint(),
				layout = clone(state.layout);
			layout.name = ($('layoutName').value.trim() || 'Untitled layout').slice(0, 80);
			if (copy) layout.name = `${layout.name.slice(0, 75)} copy`;
			const id = copy || !state.layoutId ? uid() : state.layoutId;
			await storage('put', {
				id,
				name: layout.name,
				updatedAt: new Date().toISOString(),
				document: payload(layout),
			});
			// Preserve any edits made while the storage transaction was in progress.
			if (fingerprint() === before) {
				state.layout = layout;
				$('layoutName').value = layout.name;
			}
			state.layoutId = id;
			state.savedFingerprint = JSON.stringify(layout);
			checkpoint();
			notify(
				copy
					? 'A separate copy of this layout has been saved.'
					: 'Layout saved in this browser. Export a backup for another computer.'
			);
			if ($('layoutsDialog').open) await renderSavedLayouts();
		} finally {
			saving = false;
			$('saveLayout').disabled = $('saveCopy').disabled = false;
		}
	}
	async function confirmAction(title, message, yes = 'Continue') {
		const dialog = $('confirmDialog');
		$('confirmTitle').textContent = title;
		$('confirmMessage').textContent = message;
		$('confirmYes').textContent = yes;
		return new Promise((resolve) => {
			const clean = (value) => {
				dialog.close();
				$('confirmYes').onclick = null;
				$('confirmNo').onclick = null;
				dialog.oncancel = null;
				resolve(value);
			};
			$('confirmYes').onclick = () => clean(true);
			$('confirmNo').onclick = () => clean(false);
			dialog.oncancel = (e) => {
				e.preventDefault();
				clean(false);
			};
			dialog.showModal();
		});
	}
	async function allowReplace() {
		return (
			!state.dirty ||
			confirmAction(
				'Replace this design?',
				'The current layout has unsaved changes. Save or export it first if you want to keep those changes.',
				'Replace design'
			)
		);
	}
	async function loadLayout(layout, id = null) {
		state.layout = layout;
		state.layoutId = id;
		state.selected = null;
		state.history = [fingerprint()];
		state.historyIndex = 0;
		state.savedFingerprint = id ? fingerprint() : null;
		$('layoutName').value = layout.name;
		markChanged();
		renderDesign();
		updateUndo();
		ensureAllFonts()
			.then(renderCanvas)
			.catch((e) => notify(e.message));
		showView('design');
	}
	async function renderSavedLayouts() {
		const root = $('savedLayouts');
		root.replaceChildren(el('p', 'muted', 'Loading layouts…'));
		try {
			const records = (await storage('getAll')).sort((a, b) =>
				b.updatedAt.localeCompare(a.updatedAt)
			);
			root.replaceChildren();
			if (!records.length) {
				root.append(
					el(
						'p',
						'muted',
						'No saved layouts yet. Save your first design or import an exported layout.'
					)
				);
				return;
			}
			records.forEach((item) => {
				const row = el('div', 'saved-layout'),
					info = el('div', 'saved-info');
				info.append(
					el('strong', '', item.name),
					el('small', '', new Date(item.updatedAt).toLocaleString())
				);
				const open = el('button', '', 'Open'),
					copy = el('button', '', 'Copy'),
					remove = el('button', 'icon-button danger');
				remove.append(icon('trash'));
				remove.setAttribute('aria-label', `Delete ${item.name}`);
				open.addEventListener('click', () =>
					safe(async () => {
						if (!(await allowReplace())) return;
						const record = await storage('get', item.id);
						if (!record) throw Error('This layout no longer exists.');
						const layout = validateLayout(record.document);
						await loadLayout(layout, item.id);
						$('layoutsDialog').close();
					})
				);
				copy.addEventListener('click', () =>
					safe(async () => {
						const copyDoc = clone(item.document);
						copyDoc.layout.name = `${item.name.slice(0, 75)} copy`;
						await storage('put', {
							id: uid(),
							name: copyDoc.layout.name,
							updatedAt: new Date().toISOString(),
							document: copyDoc,
						});
						await renderSavedLayouts();
						notify('Layout copied.');
					})
				);
				remove.addEventListener('click', () =>
					safe(async () => {
						if (
							!(await confirmAction(
								'Delete saved layout?',
								`Delete “${item.name}” from this browser? Export a backup first if you need it.`,
								'Delete layout'
							))
						)
							return;
						await storage('delete', item.id);
						if (state.layoutId === item.id) {
							state.layoutId = null;
							state.savedFingerprint = null;
							markChanged();
						}
						await renderSavedLayouts();
					})
				);
				row.append(info, open, copy, remove);
				root.append(row);
			});
		} catch (e) {
			root.replaceChildren(el('p', 'notice', e.message));
		}
	}
	function download(data, name, type) {
		const blob = new Blob([data], { type }),
			url = URL.createObjectURL(blob),
			link = el('a');
		link.href = url;
		link.download = name;
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	async function importLayout(file) {
		if (!file) return;
		if (file.size > 30 * 1024 * 1024) throw Error('Choose a layout smaller than 30 MB.');
		let parsed;
		try {
			parsed = JSON.parse(await file.text());
		} catch {
			throw Error('This layout file is not valid JSON.');
		}
		const layout = validateLayout(parsed);
		// Decode every image before replacing a valid open design.
		await Promise.all(
			layout.objects
				.filter((o) => o.type === 'image')
				.map(async (o) => {
					const image = new Image();
					image.src = o.src;
					try {
						await image.decode();
					} catch {
						throw Error('A layout image is damaged or unsupported.');
					}
				})
		);
		if (!(await allowReplace())) return;
		await loadLayout(layout);
		$('layoutsDialog').close();
		notify('Layout imported. Save it to add it to your layouts.');
	}

	function printOptions() {
		const values = ['printFrom', 'printTo', 'printCopies', 'startSlot', 'offsetX', 'offsetY'].map(
			(id) => ($(id).value === '' ? NaN : Number($(id).value))
		);
		const [from, to, copies, skip, offsetX, offsetY] = values;
		if (![offsetX, offsetY].every((v) => Number.isFinite(v) && Math.abs(v) <= 5))
			throw Error('Alignment adjustments must be between −5 and +5 mm.');
		return {
			...makePlan(state.rows.length, from, to, copies, skip, currentTemplate()),
			from,
			to,
			copies,
			skip,
			offsetX,
			offsetY,
		};
	}
	function makeSheet(pageIndex, plan, test = false) {
		const sheet = el('div', 'print-sheet');
		for (let slot = 0; slot < capacity(currentTemplate()); slot++) {
			const index = plan.slots[pageIndex * capacity(currentTemplate()) + slot],
				card = el('div', 'print-card');
			const pos = cardPosition(slot, plan.offsetX, plan.offsetY, currentTemplate());
			card.style.left = `${pos.x}in`;
			card.style.top = `${pos.y}in`;
			if (test) {
				card.classList.add('alignment-card');
				card.append(
					el('strong', '', `Card ${slot + 1}`),
					el('small', '', `${currentTemplate().name} - ${dimensions(currentTemplate())}`),
					el('small', '', 'Print at 100% / actual size')
				);
			} else if (index !== null && index !== undefined) {
				const artwork = el('div', 'card-artwork');
				card.dataset.record = index + 1;
				card.append(artwork);
			} else card.classList.add('empty-slot');
			sheet.append(card);
		}
		return sheet;
	}
	function fillSheet(sheet, plan, pageIndex) {
		[...sheet.children].forEach((card, slot) => {
			const art = card.querySelector('.card-artwork');
			if (art) renderArtwork(art, state.rows[plan.slots[pageIndex * capacity(currentTemplate()) + slot]]);
		});
	}
	function updateSheetPreview() {
		syncTemplateUI();
		state.printReady = false;
		try {
			state.plan = printOptions();
			state.printPage = clamp(state.printPage, 0, state.plan.pages - 1);
			const sheet = makeSheet(state.printPage, state.plan);
			$('sheetPreview').replaceChildren(sheet);
			fillSheet(sheet, state.plan, state.printPage);
			$('sheetPage').textContent = `${state.printPage + 1} / ${state.plan.pages}`;
			$('printSummary').textContent =
				`${state.plan.count.toLocaleString()} cards - ${state.plan.pages} sheet${state.plan.pages === 1 ? '' : 's'}${state.sample ? ' - Sample records' : ''}`;
			const warnings = fontManager.messages(state.layout.objects);
			if (state.layout.objects.some((o) => outsideCard(o, currentTemplate())))
				warnings.push('Objects extend beyond the card outline and may be clipped. Review the design before printing.');
			if (state.sample)
				warnings.push(
					'You are previewing fictional sample records. Import your spreadsheet before printing cards.'
				);
			const missing = missingFields();
			if (missing.length)
				warnings.push(`Missing merge fields: ${missing.join(', ')}. Fix these before printing.`);
			if ($('sheetPreview').querySelector('.overflow'))
				warnings.push(
					'Some text is too large for its box. Enlarge the box or enable “Shrink text to fit”. All selected records will be checked before printing.'
				);
			showMessage('printWarnings', warnings.join(' '));
			$('preparePrint').disabled = !!missing.length;
			$('prevSheet').disabled = state.printPage === 0;
			$('nextSheet').disabled = state.printPage >= state.plan.pages - 1;
		} catch (e) {
			state.plan = null;
			$('sheetPreview').replaceChildren();
			$('printSummary').textContent = '';
			$('sheetPage').textContent = '—';
			showMessage(
				'printWarnings',
				state.rows.length ? e.message : 'Import a spreadsheet to preview and print cards.'
			);
			$('preparePrint').disabled = true;
			$('prevSheet').disabled = $('nextSheet').disabled = true;
		}
		resizeSheet();
	}
	function resizeSheet() {
		if (state.view !== 'print') return;
		const scale = Math.min(
			0.85,
			Math.max(
				180,
				$('sheetPreviewFrame').parentElement.clientWidth - (innerWidth < 600 ? 36 : 80)
			) / (currentTemplate().page.width * DPI)
		);
		$('sheetPreview').style.transform = `scale(${scale})`;
		$('sheetPreviewFrame').style.width = `${currentTemplate().page.width * DPI * scale}px`;
		$('sheetPreviewFrame').style.height = `${currentTemplate().page.height * DPI * scale}px`;
	}
	async function preflight(plan) {
		const missing = missingFields();
		if (missing.length)
			throw Error(
				`Missing fields: ${missing.join(', ')}. Match the column headings before printing.`
			);
		const root = $('measureRoot'),
			errors = [];
		root.replaceChildren();
		// Measure one unscaled card at a time. This is independent of screen zoom.
		const art = el('div', 'card-artwork');
		art.style.height = `${state.layout.height * DPI}px`;
		root.append(art);
		for (let rowIndex = plan.from - 1; rowIndex < plan.to; rowIndex++) {
			await Promise.all(state.layout.objects.filter((o) => o.type === 'text').map((o) =>
				fontManager.loadText(o, merge(o.text, state.rows[rowIndex]))));
			renderArtwork(art, state.rows[rowIndex]);
			for (const node of art.querySelectorAll('.overflow')) {
				const o = state.layout.objects.find((o) => o.id === node.dataset.id);
				errors.push(`record ${rowIndex + 1} (${o.name})`);
				if (errors.length >= 5) break;
			}
			if (errors.length >= 5) break;
			if (rowIndex % 80 === 0) {
				$('printStatus').textContent = `Checking record ${rowIndex + 1} of ${plan.to}…`;
				await new Promise(requestAnimationFrame);
			}
		}
		root.replaceChildren();
		if (errors.length)
			throw Error(
				`Text does not fit: ${errors.join('; ')}. Enlarge those boxes or reduce their font size before printing.`
			);
	}
	function syncPrintRoot(plan, test = false) {
		$('printRoot').replaceChildren();
		const total = test ? 1 : plan.pages;
		for (let i = 0; i < total; i++) $('printRoot').append(makeSheet(i, plan, test));
		// Keep the real DOM measurable while preparing. display:none would give text boxes zero dimensions and incorrectly shrink every name to 6 pt.
		$('printRoot').style.cssText = 'display:block;position:absolute;left:-20000px;top:0;';
		if (!test) [...$('printRoot').children].forEach((sheet, i) => fillSheet(sheet, plan, i));
		$('printRoot').style.cssText = '';
	}
	async function printCards(test = false) {
		if (state.printBusy) return;
		state.printBusy = true;
		$('preparePrint').disabled = $('printTest').disabled = true;
		try {
			const offsetX = Number($('offsetX').value),
				offsetY = Number($('offsetY').value);
			if (![offsetX, offsetY].every((v) => Number.isFinite(v) && Math.abs(v) <= 5))
				throw Error('Alignment adjustments must be between −5 and +5 mm.');
			const plan = test ? { slots: [], pages: 1, offsetX, offsetY } : printOptions();
			if (!test) {
				if (
					state.sample &&
					!(await confirmAction(
						'Print sample records?',
						'The spreadsheet still contains fictional sample records. Continue to test the layout, or cancel and import your own spreadsheet.',
						'Print sample'
					))
				)
					return;
				$('app').inert = true;
				await ensureAllFonts();
				await preflight(plan);
			}
			syncPrintRoot(plan, test);
			await Promise.all([...$('printRoot').querySelectorAll('img')].map((img) => img.decode()));
			state.printReady = true;
			$('printStatus').textContent = test
				? 'Alignment test ready. Use plain paper and 100% scale.'
				: `${plan.count} cards ready. Use ${currentTemplate().page.name} paper, 100% scale, and no margins.`;
			window.print();
		} catch (e) {
			state.printReady = false;
			$('printRoot').replaceChildren();
			$('printStatus').textContent = e.message;
			notify(e.message, 8000);
		} finally {
			$('app').inert = false;
			state.printBusy = false;
			$('printTest').disabled = false;
			$('preparePrint').disabled = !state.rows.length || !!missingFields().length;
		}
	}
	window.addEventListener('beforeprint', () => {
		if (!state.printReady) {
			$('printRoot').replaceChildren(
				el(
					'p',
					'print-error',
					'Use the “Preview & print” tab and “Print cards / Save PDF” button to prepare and check your cards first.'
				)
			);
		}
	});
	window.addEventListener('afterprint', () => {
		state.printReady = false;
		$('printRoot').replaceChildren();
	});

	function showView(view) {
		if (!['data', 'design', 'print'].includes(view)) return;
		state.view = view;
		for (const name of ['data', 'design', 'print']) {
			$(`view-${name}`).hidden = name !== view;
			$(`tab-${name}`).setAttribute('aria-selected', String(name === view));
			$(`tab-${name}`).tabIndex = name === view ? 0 : -1;
		}
		if (view === 'design') {
			renderDesign();
			ensureAllFonts()
				.then(renderCanvas)
				.catch((e) => notify(e.message));
		}
		if (view === 'data') renderDataTable();
		if (view === 'print') {
			updateSheetPreview();
			ensureAllFonts()
				.then(() => {
					if (state.view === 'print') updateSheetPreview();
				})
				.catch((e) => showMessage('printWarnings', e.message));
		}
	}
	async function safe(fn) {
		try {
			await fn();
		} catch (e) {
			notify(e.message || 'Something went wrong. Please try again.', 8000);
		}
	}
	document
		.querySelectorAll('[data-view]')
		.forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
	document.querySelector('.view-tabs').addEventListener('keydown', (e) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		e.preventDefault();
		const tabs = ['data', 'design', 'print'],
			current = tabs.indexOf(state.view),
			next =
				e.key === 'Home'
					? 0
					: e.key === 'End'
						? 2
						: (current + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
		showView(tabs[next]);
		$(`tab-${tabs[next]}`).focus();
	});
	$('brand').addEventListener('click', (e) => {
		e.preventDefault();
		showView('design');
	});
	$('addText').addEventListener('click', () =>
		fitAndAddObject(textObject('Text', 'Your text', 0.3, 0.8, 2.9, 0.4, 18))
	);
	$('addShape').addEventListener('click', () =>
		fitAndAddObject(shapeObject('Shape', 0.4, 0.7, 1, 0.5, '#dce5f0'))
	);
	$('addImage').addEventListener('click', () => {
		imageReplacement = null;
		$('imageFile').click();
	});
	$('replaceImage').addEventListener('click', () => {
		imageReplacement = state.selected;
		$('imageFile').click();
	});
	$('imageFile').addEventListener('change', () => {
		const file = $('imageFile').files[0];
		$('imageFile').value = '';
		safe(() => importImage(file));
	});
	$('duplicateObject').addEventListener('click', duplicateObject);
	$('deleteObject').addEventListener('click', removeObject);
	$('bringForward').addEventListener('click', () => moveLayer(1));
	$('sendBackward').addEventListener('click', () => moveLayer(-1));
	$('undo').addEventListener('click', () => undo(-1));
	$('redo').addEventListener('click', () => undo(1));
	$('zoom').addEventListener('change', resizeCanvas);
	$('showGuides').addEventListener('change', renderCanvas);
	$('mergePreview').addEventListener('change', renderCanvas);
	$('prevRecord').addEventListener('click', () => setRecord(state.record - 1));
	$('nextRecord').addEventListener('click', () => setRecord(state.record + 1));
	$('recordIndex').addEventListener('change', () => setRecord(Number($('recordIndex').value) - 1));
	$('chooseData').addEventListener('click', () => $('dataFile').click());
	$('dataFile').addEventListener('change', () => {
		const f = $('dataFile').files[0];
		$('dataFile').value = '';
		safe(async () => {
			try {
				await importData(f);
			} catch (e) {
				showMessage('dataMessage', e.message);
				throw e;
			}
		});
	});
	for (const event of ['dragover', 'dragenter'])
		$('dropZone').addEventListener(event, (e) => {
			e.preventDefault();
			$('dropZone').classList.add('over');
		});
	$('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('over'));
	$('dropZone').addEventListener('drop', (e) => {
		e.preventDefault();
		$('dropZone').classList.remove('over');
		safe(async () => {
			try {
				await importData(e.dataTransfer.files[0]);
			} catch (err) {
				showMessage('dataMessage', err.message);
				throw err;
			}
		});
	});
	$('sheetSelect').addEventListener('change', () =>
		safe(async () => {
			const previous = state.sheetName,
				name = $('sheetSelect').value;
			try {
				const result = readWorksheet(state.workbook, name);
				state.sheetName = name;
				applyData(result, workbookFileName, false);
				showMessage('dataMessage', result.notices.join(' '));
			} catch (e) {
				$('sheetSelect').value = previous;
				showMessage('dataMessage', e.message);
			}
		})
	);
	$('loadSample').addEventListener('click', () =>
		safe(async () => {
			if (
				state.rows.length &&
				!state.sample &&
				!(await confirmAction(
					'Replace imported records?',
					'Load fictional sample records instead? You can import your spreadsheet again later.',
					'Load sample'
				))
			)
				return;
			loadSample();
		})
	);
	$('clearData').addEventListener('click', () => {
		dataImportSerial++;
		state.workbook = null;
		state.sheetName = '';
		applyData({ headers: [], rows: [] }, 'No spreadsheet', false);
		populateSheets();
		showMessage('dataMessage', 'Spreadsheet records cleared. The layout is unchanged.');
	});
	$('prevDataPage').addEventListener('click', () => {
		if (state.dataPage > 0) state.dataPage--;
		renderDataTable();
	});
	$('nextDataPage').addEventListener('click', () => {
		if ((state.dataPage + 1) * 50 < state.rows.length) state.dataPage++;
		renderDataTable();
	});
	$('layoutName').addEventListener('input', () => {
		state.layout.name = $('layoutName').value;
		markChanged();
	});
	$('layoutName').addEventListener('change', checkpoint);
	$('saveLayout').addEventListener('click', () => safe(() => saveLayout()));
	$('saveCopy').addEventListener('click', () => safe(() => saveLayout(true)));
	$('openLayouts').addEventListener('click', () => {
		$('layoutsDialog').showModal();
		renderSavedLayouts();
	});
	$('exportLayout').addEventListener('click', () => {
		download(
			JSON.stringify(payload(), null, 2),
			`${escapeName(state.layout.name)}.cardlayout.json`,
			'application/json'
		);
		notify('Layout exported with images, without spreadsheet records.');
	});
	$('importLayout').addEventListener('click', () => $('layoutFile').click());
	$('layoutFile').addEventListener('change', () => {
		const f = $('layoutFile').files[0];
		$('layoutFile').value = '';
		safe(() => importLayout(f));
	});
	$('newLayout').addEventListener('click', () =>
		safe(async () => {
			if (!(await allowReplace())) return;
			await loadLayout({
				name: 'Untitled layout',
				templateId: state.layout.templateId,
				width: state.layout.width,
				height: state.layout.height,
				background: '#ffffff',
				objects: [],
			});
		})
	);
	$('helpButton').addEventListener('click', () => $('helpDialog').showModal());
	document
		.querySelectorAll('[data-close]')
		.forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
	for (const id of ['printFrom', 'printTo', 'printCopies', 'startSlot', 'offsetX', 'offsetY'])
		$(id).addEventListener('change', () => {
			state.printPage = 0;
			$('printRoot').replaceChildren();
			updateSheetPreview();
		});
	$('prevSheet').addEventListener('click', () => {
		state.printPage--;
		updateSheetPreview();
	});
	$('nextSheet').addEventListener('click', () => {
		state.printPage++;
		updateSheetPreview();
	});
	$('preparePrint').addEventListener('click', () => printCards());
	$('printTest').addEventListener('click', () => printCards(true));
	document.addEventListener('keydown', (e) => {
		if (document.querySelector('dialog[open]')) return;
		const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 's') {
			e.preventDefault();
			document.activeElement?.blur();
			safe(() => saveLayout());
			return;
		}
		if (mod && e.key.toLowerCase() === 'p') {
			e.preventDefault();
			showView('print');
			safe(() => printCards());
			return;
		}
		if (typing) return;
		if (mod && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undo(e.shiftKey ? 1 : -1);
		}
		if (mod && e.key.toLowerCase() === 'y') {
			e.preventDefault();
			undo(1);
		}
		if (mod && e.key.toLowerCase() === 'd' && selected()) {
			e.preventDefault();
			duplicateObject();
		}
		if (e.key === 'Escape') selectObject(null);
		if (state.view !== 'design' || !selected()) return;
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			removeObject();
		}
		const o = selected(),
			step = e.shiftKey ? 0.1 : 0.01;
		if (
			o &&
			['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
			!e.target.closest('.view-tabs')
		) {
			e.preventDefault();
			if (e.key === 'ArrowLeft') o.x -= step;
			if (e.key === 'ArrowRight') o.x += step;
			if (e.key === 'ArrowUp') o.y -= step;
			if (e.key === 'ArrowDown') o.y += step;
			o.x = round(clamp(o.x, -OBJECT_LIMITS.x, OBJECT_LIMITS.x));
			o.y = round(clamp(o.y, -OBJECT_LIMITS.y, OBJECT_LIMITS.y));
			checkpoint();
			renderDesign();
		}
	});
	window.addEventListener('beforeunload', (e) => {
		if (state.dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	});
	new ResizeObserver(() => {
		resizeCanvas();
		resizeSheet();
	}).observe($('app'));
	for (const id of ['paperStock', 'printPaperStock']) {
		for (const stock of Templates.stocks) {
			const option = el('option', '', `${stock.name} - ${dimensions(Templates.get(stock.id))}`);
			option.value = stock.id;
			$(id).append(option);
		}
		$(id).addEventListener('change', () => changeTemplate($(id).value));
	}
	// A new weight or language subset can arrive after the first text measurement.
	document.fonts.addEventListener('loadingdone', () => {
		if (state.view === 'design') renderCanvas();
		else if (state.view === 'print' && !state.printBusy && !state.printReady) updateSheetPreview();
	});
	fontManager.initPicker({ apply: applyFont, refresh: renderDesign, objects: () => state.layout.objects });
	state.history = [fingerprint()];
	state.savedFingerprint = fingerprint();
	state.selected = state.layout.objects.find((o) => o.name === 'Name').id;
	loadSample();
	renderDesign();
	updateUndo();
	showView('design');
})();
