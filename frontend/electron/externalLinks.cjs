// External links of the app window: web pages (provider pages, image pages...) open in the user's browser, never
// inside Electron. window.open / target="_blank" links are denied and opened with shell.openExternal; a navigation
// of the window itself to another http(s) origin is prevented and opened externally too. Navigations inside the app
// (same origin, e.g. the dev server reloading) are left alone. Pure helpers: Electron objects are passed in.

/** @param {string} url */
function parseUrl(url) {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

/**
 * An http(s) URL outside the app: another origin than `appUrl` (the page loaded in the window; omitted or not
 * http(s), e.g. file://, every http(s) URL is external).
 * @param {string} url
 * @param {string} [appUrl]
 */
function isExternalHttpUrl(url, appUrl = '') {
	const target = parseUrl(url);
	if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
		return false;
	}
	const app = parseUrl(appUrl);
	return !app || target.origin !== app.origin;
}

/**
 * @param {{ openExternal(url: string): Promise<void> }} shell
 * @param {string} url
 */
function openExternal(shell, url) {
	Promise.resolve(shell.openExternal(url)).catch((error) => {
		console.error(`Could not open ${url}:`, error);
	});
}

/**
 * @param {import('electron').WebContents} webContents the window's web contents
 * @param {{ openExternal(url: string): Promise<void> }} shell Electron's shell
 */
function installExternalLinkHandler(webContents, shell) {
	webContents.setWindowOpenHandler(({ url }) => {
		if (isExternalHttpUrl(url)) {
			openExternal(shell, url);
		}
		return { action: 'deny' };
	});
	webContents.on('will-navigate', (event, legacyUrl) => {
		// Electron passes the URL on the event (details.url); older versions only as the second argument.
		const url = typeof event.url === 'string' ? event.url : legacyUrl;
		if (typeof url === 'string' && isExternalHttpUrl(url, webContents.getURL())) {
			event.preventDefault();
			openExternal(shell, url);
		}
	});
}

module.exports = { isExternalHttpUrl, installExternalLinkHandler };
