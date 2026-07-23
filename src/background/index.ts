import browser from 'webextension-polyfill';

import { aria2Client } from '@/lib/aria2c';
import { client } from '@/lib/browser';
import { cacheSet } from '@/lib/session-cache';
import { isEnabled, toggleEnabled } from '@/lib/storage';
import { MessageSchema, MessageType } from '@/types';

console.log('[Aria2Ex] background script loaded');

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

// ─── Context menus (top-level — runs on every service worker start) ────────

try {
	browser.contextMenus.create({
		id: CONTEXT_ID,
		title: 'Download with Aria2',
		contexts: ['link', 'video', 'audio'],
	});
	browser.contextMenus.create({
		id: TOGGLE_CONTEXT_ID,
		title: 'Toggle Aria2Ex',
		contexts: ['action'],
	});
	console.log('[Aria2Ex] context menus created');
} catch (e) {
	console.error('[Aria2Ex] failed to create context menus', e);
}

// Initialize icon state on startup
isEnabled()
	.then(updateIconForState)
	.then(() => console.log('[Aria2Ex] icon state initialized'))
	.catch((e) => console.error('[Aria2Ex] icon init failed', e));

// ─── Context menu click handler ─────────────────────────────────────────────

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
console.log('[Aria2Ex] download interceptor registered');

// ─── Left-click → popup, middle-click → toggle ──────────────────────────────
// No default_popup in manifest, so onClicked fires for all clicks.
// browser.action.openPopup() must be called from an onClicked handler.

browser.action.onClicked.addListener(async (_tab, info) => {
	console.log('[Aria2Ex] action clicked, button:', info?.button);
	if (info?.button === 1) {
		// Middle-click → toggle
		const newEnabled = await toggleEnabled();
		await updateIconForState(newEnabled);
		return;
	}
	// Left-click → open the popup panel
	try {
		await browser.action.openPopup();
	} catch (e) {
		console.error('[Aria2Ex] openPopup failed', e);
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
