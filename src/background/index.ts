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
		// Show "OFF" badge with red background
		await browser.action.setBadgeText({ text: 'OFF' });
		await browser.action.setBadgeBackgroundColor({ color: '#cc0000' });
		await browser.action.setTitle({ title: 'Aria2Ex (DISABLED)' });
	} else {
		// Clear the disabled badge — the polling loop will restore job count
		await browser.action.setBadgeText({ text: '' });
		await browser.action.setTitle({ title: 'Aria2Ex' });
	}
}

// ─── Context menus ──────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(async () => {
	// Existing: right-click on links/videos/audio
	browser.contextMenus.create({
		id: CONTEXT_ID,
		title: 'Download with Aria2',
		contexts: ['link', 'video', 'audio'],
	});

	// New: right-click on the extension icon itself
	browser.contextMenus.create({
		id: TOGGLE_CONTEXT_ID,
		title: 'Toggle Aria2Ex',
		contexts: ['browser_action'],
	});

	// Set initial icon state
	const enabled = await isEnabled();
	await updateIconForState(enabled);
});

browser.contextMenus.onClicked.addListener(async (info, _tab) => {
	if (info.menuItemId === CONTEXT_ID) {
		// Gate the "Download with Aria2" context menu behind enabled flag
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
		await client.notify(
			newEnabled ? 'Aria2Ex enabled.' : 'Aria2Ex disabled.',
		);
	}
});

// ─── Download interceptor ───────────────────────────────────────────────────

client.registerDownloadInterceptor();

// ─── Middle-click toggle on extension icon ───────────────────────────────────
// Removing default_popup from manifest enables this listener.
// Left-click  (button 0) → open the popup UI
// Middle-click (button 1) → toggle enabled/disabled

browser.action.onClicked.addListener(async (_tab, info) => {
	if (info?.button === 1) {
		// Middle-click → toggle
		const newEnabled = await toggleEnabled();
		await updateIconForState(newEnabled);
		await client.notify(
			newEnabled ? 'Aria2Ex enabled.' : 'Aria2Ex disabled.',
		);
		return;
	}

	// Left-click → open popup programmatically
	if (browser.action.openPopup) {
		await browser.action.openPopup();
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
			// When disabled, keep the "OFF" badge and skip aria2 polling
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
