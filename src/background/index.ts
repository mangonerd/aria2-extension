import browser from 'webextension-polyfill';

import { aria2Client } from '@/lib/aria2c';
import { client } from '@/lib/browser';
import { cacheSet } from '@/lib/session-cache';
import { isEnabled, toggleEnabled } from '@/lib/storage';
import { MessageSchema, MessageType } from '@/types';

const CONTEXT_ID = 'download-with-aria';
const TOGGLE_CONTEXT_ID = 'toggle-aria2ex';

// ─── Icon helpers ───────────────────────────────────────────────────────────

async function updateIconForState(enabled: boolean): Promise<void> {
	if (!enabled) {
		await browser.action.setBadgeText({ text: 'OFF' });
		await browser.action.setBadgeBackgroundColor({ color: '#cc0000' });
		await browser.action.setTitle({ title: 'Aria2Ex (DISABLED)' });
	} else {
		await browser.action.setBadgeText({ text: '' });
		await browser.action.setTitle({ title: 'Aria2Ex' });
	}
}

// ─── Context menus ──────────────────────────────────────────────────────────

// Create context menus at top level so they exist on every service worker start
browser.runtime.onInstalled.addListener(async () => {
	const enabled = await isEnabled();
	await updateIconForState(enabled);
});

// Right-click on links/videos/audio
browser.contextMenus.create({
	id: CONTEXT_ID,
	title: 'Download with Aria2',
	contexts: ['link', 'video', 'audio'],
});

// Right-click on the extension icon itself
browser.contextMenus.create({
	id: TOGGLE_CONTEXT_ID,
	title: 'Toggle Aria2Ex',
	contexts: ['browser_action'],
});

// Initialize icon state on startup
isEnabled().then(updateIconForState);

browser.contextMenus.onClicked.addListener(async (info, _tab) => {
	if (info.menuItemId === CONTEXT_ID) {
		if (!(await isEnabled())) {
			return;
		}
		const url = info.srcUrl ?? info.linkUrl;
		if (!url) {
			return;
		}
		try {
			const c = await aria2Client();
			await c.addUri(url);
		} catch (e) {
			console.error('Failed to download with Aria2', e);
			await client.notify('Failed to download with Aria2.');
		}
	}

	if (info.menuItemId === TOGGLE_CONTEXT_ID) {
		const newEnabled = await toggleEnabled();
		await updateIconForState(newEnabled);
	}
});

// ─── Download interceptor ───────────────────────────────────────────────────

client.registerDownloadInterceptor();

// ─── Middle-click toggle + left-click popup ──────────────────────────────────

browser.action.onClicked.addListener(async (_tab, info) => {
	if (info?.button === 1) {
		// Middle-click → toggle
		const newEnabled = await toggleEnabled();
		await updateIconForState(newEnabled);
		return;
	}

	// Left-click → open popup page in a small window
	try {
		const baseUrl = browser.runtime.getURL('index.html');
		const w = 400;
		const h = 500;
		const dualScreenLeft = window.screenLeft ?? window.screenX;
		const dualScreenTop = window.screenTop ?? window.screenY;
		const width = window.innerWidth
			? window.innerWidth
			: document.documentElement.clientWidth
				? document.documentElement.clientWidth
				: screen.width;
		const height = window.innerHeight
			? window.innerHeight
			: document.documentElement.clientHeight
				? document.documentElement.clientHeight
				: screen.height;
		const systemZoom = width / window.screen.availWidth;
		const top = Math.round((height - h) / 2 / systemZoom + dualScreenTop);
		const left = Math.round((width - w) / 2 / systemZoom + dualScreenLeft);

		await browser.windows.create({
			url: baseUrl,
			type: 'popup',
			top,
			left,
			width: w,
			height: h,
			focused: true,
		});
	} catch (e) {
		console.error('Failed to open popup', e);
	}
});

// ─── Keyboard command ───────────────────────────────────────────────────────

browser.commands.onCommand.addListener((command: string) => {
	if (command === 'open_detail') {
		client.openDetail(false);
	}
});

// ─── Message handler ────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(async (data: unknown) => {
	const result = MessageSchema.safeParse(data);
	if (!result.success) {
		console.error('Invalid message', result.error);
		return;
	}
	if (result.data.type === MessageType.Signal) {
		return cacheSet(result.data.message);
	}

	// Handle toggle/getEnabled messages regardless of enabled state
	if (result.data.type === MessageType.ToggleEnabled) {
		const newEnabled = await toggleEnabled();
		await updateIconForState(newEnabled);
		return { enabled: newEnabled };
	}
	if (result.data.type === MessageType.GetEnabled) {
		return { enabled: await isEnabled() };
	}

	// Gate download-related messages behind enabled flag
	if (
		result.data.type === MessageType.AddUri ||
		result.data.type === MessageType.AddUris
	) {
		if (!(await isEnabled())) {
			return { error: 'Aria2Ex is disabled' };
		}
	}

	try {
		const c = await aria2Client();
		switch (result.data.type) {
			case MessageType.GetJobs:
				return c.getJobs();
			case MessageType.GetNumJobs:
				return c.getNumJobs();
			case MessageType.AddUri:
				return c.addUri(
					result.data.link,
					result.data.filename,
					result.data.options,
				);
			case MessageType.AddUris:
				return c.addUris(...result.data.uris);
			case MessageType.StartJobs:
				return c.startJobs(...result.data.gids);
			case MessageType.PauseJobs:
				return c.pauseJobs(...result.data.gids);
			case MessageType.RemoveJobs:
				return c.removeJobs(...result.data.gids);
		}
	} catch (e) {
		console.error('Failed to handle message', result.data.type, e);
	}
});

// ─── Badge polling ──────────────────────────────────────────────────────────

const POLL_MIN = 1000;
const POLL_MAX = 30_000;
let pollInterval = POLL_MIN;

async function updateActiveJobNumber(): Promise<void> {
	try {
		const enabled = await isEnabled();
		if (!enabled) {
			await updateIconForState(false);
			pollInterval = POLL_MIN;
		} else {
			const c = await aria2Client();
			const num = await c.getNumJobs();
			await client.updateBadge(num);
			pollInterval = POLL_MIN;
		}
	} catch (e) {
		console.error('Failed to update job number', e);
		pollInterval = Math.min(pollInterval * 2, POLL_MAX);
	} finally {
		setTimeout(updateActiveJobNumber, pollInterval);
	}
}

updateActiveJobNumber();
