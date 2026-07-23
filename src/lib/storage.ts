import browser from 'webextension-polyfill';

const ENABLED_KEY = 'aria2ex_enabled';

export async function isEnabled(): Promise<boolean> {
	const result = await browser.storage.local.get(ENABLED_KEY);
	// Default to true if not set (extension is enabled by default)
	return result[ENABLED_KEY] !== false;
}

export async function setEnabled(enabled: boolean): Promise<void> {
	await browser.storage.local.set({ [ENABLED_KEY]: enabled });
}

export async function toggleEnabled(): Promise<boolean> {
	const current = await isEnabled();
	const next = !current;
	await setEnabled(next);
	return next;
}
