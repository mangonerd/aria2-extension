import type { Manifest } from 'webextension-polyfill';

import pkg from '../package.json';

const base = {
	manifest_version: 3,
	name: pkg.displayName,
	version: pkg.version,
	icons: {
		'48': 'logo48.png',
		'128': 'logo128.png',
	},
	permissions: [
		'tabs',
		'contextMenus',
		'notifications',
		'storage',
		'downloads',
	],
	host_permissions: ['<all_urls>'],
	content_security_policy: {
		extension_pages: "script-src 'self'; object-src 'self';",
	},
	commands: {
		open_detail: {
			description: 'Open AriaNg',
		},
	},
	action: {
		default_title: 'Aria2Ex',
	},
	options_ui: {
		page: 'index.html#/setting',
		open_in_tab: true,
	},
};

export const Chrome = {
	...base,
	background: {
		service_worker: 'background/index.js',
		type: 'module' as const,
	},
};

export const Firefox: Manifest.WebExtensionManifest = {
	...base,
	background: {
		scripts: ['background/index.js'],
		type: 'module',
	},
	browser_specific_settings: {
		gecko: {
			id: '{b3b1e4a8-7f2c-4d9e-a6c5-8e1f0b3d2a71}',
		},
	},
};
