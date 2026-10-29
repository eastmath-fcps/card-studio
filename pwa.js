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
