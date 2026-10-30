(() => {
	'use strict';
	const button = document.getElementById('installApp');
	const dialog = document.getElementById('installDialog');
	const appleSteps = document.getElementById('installAppleSteps');
	const errorMessage = document.getElementById('installError');
	const appDisplay = window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)');
	const canInstall = window.isSecureContext && /^https?:$/.test(location.protocol);
	// iPads can identify as Macs when requesting the desktop version of a site.
	const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	let pendingPrompt = null;
	let installedThisPage = false;
	let prompting = false;

	function isInstalled() {
		return installedThisPage || appDisplay.matches || navigator.standalone === true;
	}

	function updateButton() {
		button.hidden = !canInstall || isInstalled() || (!pendingPrompt && !isAppleMobile);
		button.disabled = prompting;
	}

	function showInstructions(failed = false) {
		appleSteps.hidden = failed || !isAppleMobile;
		errorMessage.hidden = !failed;
		if (!dialog.open) dialog.showModal();
	}

	window.addEventListener('beforeinstallprompt', (event) => {
		if (!canInstall || typeof event.prompt !== 'function') return;
		event.preventDefault();
		if (isInstalled()) return;
		pendingPrompt = event;
		updateButton();
	});

	window.addEventListener('appinstalled', () => {
		installedThisPage = true;
		pendingPrompt = null;
		if (dialog.open) dialog.close();
		updateButton();
	});

	appDisplay.addEventListener('change', () => {
		if (isInstalled()) {
			pendingPrompt = null;
			if (dialog.open) dialog.close();
		}
		updateButton();
	});
	// Recheck when a mobile browser restores this page from its back/forward cache.
	window.addEventListener('pageshow', updateButton);
	document.getElementById('closeInstallDialog').addEventListener('click', () => dialog.close());
	dialog.addEventListener('close', () => {
		if (button.hidden) document.getElementById('helpButton').focus();
	});

	button.addEventListener('click', async () => {
		if (!canInstall || isInstalled() || prompting) return;
		if (!pendingPrompt) {
			if (isAppleMobile) showInstructions();
			return;
		}
		// Prompt only once, consume it before awaiting anything, and call prompt() directly from this click to preserve user activation.
		const event = pendingPrompt;
		pendingPrompt = null;
		prompting = true;
		button.disabled = true;
		try {
			await event.prompt();
			const choice = await event.userChoice;
			// 'appinstalled' is authoritative; acceptance also hides the promotion while installation finishes. Never persist this flag across visits.
			if (choice?.outcome === 'accepted') installedThisPage = true;
		} catch {
			showInstructions(true);
		} finally {
			prompting = false;
			updateButton();
			if (button.hidden && document.activeElement === button) {
				document.getElementById('helpButton').focus();
			}
		}
	});

	updateButton();
})();

(() => {
	'use strict';
	if (!('serviceWorker' in navigator) || !window.isSecureContext || !/^https?:$/.test(location.protocol)) return;
	const status = document.getElementById('offlineStatus');
	const updateButton = document.getElementById('updateApp');
	const dialog = document.getElementById('updateDialog');
	const applyButton = document.getElementById('applyUpdate');
	const laterButton = document.getElementById('postponeUpdate');
	const closeButton = document.getElementById('closeUpdateDialog');
	const error = document.getElementById('updateError');
	let registration, offlineReady = false, applying = false, reloadApproved = false;
	let reloadTimer, lastCheck = 0;

	function message(worker, type) {
		return new Promise((resolve, reject) => {
			if (!worker) return reject(Error('The update is no longer available. Try again after reconnecting.'));
			const channel = new MessageChannel();
			const timer = setTimeout(() => {
				channel.port1.close();
				reject(Error('The app did not respond. Keep working and try again later.'));
			}, 10000);
			channel.port1.onmessage = ({ data }) => {
				clearTimeout(timer);
				channel.port1.close();
				resolve(data);
			};
			worker.postMessage({ type }, [channel.port2]);
		});
	}

	function renderStatus(failed = false) {
		status.hidden = false;
		status.textContent = !navigator.onLine ? (offlineReady ? 'Offline' : 'Offline unavailable') :
			offlineReady ? 'Offline ready' : failed ? 'Offline unavailable' : 'Preparing offline...';
		status.title = offlineReady ? 'The app and Excel reader are saved for offline use. New Google Fonts need a connection.' :
			'Offline files are not ready. Reconnect and reload to try again. The editor still works while this page is open.';
	}

	async function checkReady() {
		try {
			const worker = navigator.serviceWorker.controller || registration?.active;
			if (!worker || worker.state !== 'activated') return;
			offlineReady = (await message(worker, 'STATUS')).ready === true;
			renderStatus(!offlineReady);
		} catch { renderStatus(true); }
	}

	function showUpdate() {
		updateButton.hidden = !registration?.waiting;
	}

	function setBusy(value) {
		applying = value;
		applyButton.disabled = laterButton.disabled = closeButton.disabled = value;
	}

	function failUpdate(message) {
		reloadApproved = false;
		window.CardStudioUpdates?.cancelReload();
		clearTimeout(reloadTimer);
		setBusy(false);
		error.textContent = message;
		error.hidden = false;
	}

	updateButton.addEventListener('click', () => {
		const state = window.CardStudioUpdates?.status();
		document.getElementById('updateSaveNotice').hidden = !state?.dirty;
		document.getElementById('updateRecordsNotice').hidden = !state?.hasRecords;
		applyButton.textContent = state?.dirty ? 'Save & update' : 'Update & reload';
		error.hidden = true;
		if (!dialog.open) dialog.showModal();
	});
	for (const button of [laterButton, closeButton]) button.addEventListener('click', () => dialog.close());
	dialog.addEventListener('cancel', (event) => { if (applying) event.preventDefault(); });
	applyButton.addEventListener('click', async () => {
		if (applying) return;
		setBusy(true);
		error.hidden = true;
		try {
			const worker = registration?.waiting;
			const check = await message(worker, 'CHECK_UPDATE');
			if (!check.ok) throw Error(check.message);
			if (!window.CardStudioUpdates) throw Error('The editor is not ready. Keep working and try again later.');
			// The editor owns saving and the one-use saved-layout reference. No spreadsheet data is persisted to make a reload possible.
			await window.CardStudioUpdates.prepareReload();
			reloadApproved = true;
			reloadTimer = setTimeout(() => failUpdate('The update has not finished. Keep working and try again later.'), 15000);
			const result = await message(worker, 'APPLY_UPDATE');
			if (!result.ok) throw Error(result.message);
		} catch (e) { failUpdate(e.message); }
	});

	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (reloadApproved) {
			clearTimeout(reloadTimer);
			location.reload();
		} else {
			checkReady();
			showUpdate();
		}
	});

	async function checkForUpdate() {
		if (!registration || !navigator.onLine || Date.now() - lastCheck < 60000) return;
		lastCheck = Date.now();
		try { await registration.update(); } catch { /* Keep the cached app usable. */ }
	}
	window.addEventListener('online', () => { renderStatus(); checkReady(); checkForUpdate(); });
	window.addEventListener('offline', () => renderStatus());
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) { checkReady(); checkForUpdate(); }
	});
	window.addEventListener('pageshow', () => { checkReady(); showUpdate(); });
	renderStatus();
	navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
		registration = reg;
		showUpdate();
		checkReady();
		const watch = (worker) => {
			if (!worker) return;
			worker.addEventListener('statechange', () => {
				if (worker.state === 'installed') showUpdate();
				if (worker.state === 'activated') { checkReady(); showUpdate(); }
				if (worker.state === 'redundant' && !reg.active) renderStatus(true);
			});
		};
		watch(reg.installing);
		reg.addEventListener('updatefound', () => watch(reg.installing));
		checkForUpdate();
	}).catch(() => renderStatus(true));
})();