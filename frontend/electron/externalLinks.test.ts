// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import externalLinks from './externalLinks.cjs';

type OpenHandler = (details: { url: string }) => { action: 'deny' | 'allow' };
type NavigateListener = (event: { preventDefault(): void; url?: string }, url?: string) => void;

/** Fake WebContents recording the handlers the module installs. */
function fakeWebContents(currentUrl: string) {
	let openHandler: OpenHandler | null = null;
	let navigateListener: NavigateListener | null = null;
	const webContents = {
		getURL: () => currentUrl,
		setWindowOpenHandler: (handler: OpenHandler) => {
			openHandler = handler;
		},
		on: (event: 'will-navigate', listener: NavigateListener) => {
			expect(event).toBe('will-navigate');
			navigateListener = listener;
			return webContents;
		},
	};
	return {
		webContents,
		open: (url: string) => openHandler!({ url }),
		navigate: (url: string, { legacy = false } = {}) => {
			const event = { preventDefault: vi.fn(), ...(legacy ? {} : { url }) };
			navigateListener!(event, url);
			return event;
		},
	};
}

function fakeShell() {
	return { openExternal: vi.fn(async (_url: string) => undefined) };
}

describe('isExternalHttpUrl', () => {
	it('accepts http(s) URLs only', () => {
		expect(externalLinks.isExternalHttpUrl('https://civitai.com/images/1')).toBe(true);
		expect(externalLinks.isExternalHttpUrl('http://example.com')).toBe(true);
		expect(externalLinks.isExternalHttpUrl('file:///C:/app/index.html')).toBe(false);
		expect(externalLinks.isExternalHttpUrl('javascript:alert(1)')).toBe(false);
		expect(externalLinks.isExternalHttpUrl('mailto:someone@example.com')).toBe(false);
		expect(externalLinks.isExternalHttpUrl('not a url')).toBe(false);
	});

	it('treats the app origin as internal', () => {
		const app = 'http://127.0.0.1:5173/';
		expect(externalLinks.isExternalHttpUrl('http://127.0.0.1:5173/#/x', app)).toBe(false);
		expect(externalLinks.isExternalHttpUrl('http://127.0.0.1:8000/api', app)).toBe(true);
		expect(externalLinks.isExternalHttpUrl('https://civitai.com/', app)).toBe(true);
		// A file:// app has no http origin: every web page is external.
		expect(externalLinks.isExternalHttpUrl('https://civitai.com/', 'file:///C:/app/dist/index.html')).toBe(true);
	});
});

describe('installExternalLinkHandler', () => {
	it('opens new-window web links in the browser and never opens Electron windows', () => {
		const contents = fakeWebContents('file:///C:/app/dist/index.html');
		const shell = fakeShell();
		externalLinks.installExternalLinkHandler(contents.webContents, shell);

		expect(contents.open('https://civitai.com/images/148522541')).toEqual({ action: 'deny' });
		expect(shell.openExternal).toHaveBeenCalledWith('https://civitai.com/images/148522541');

		expect(contents.open('file:///C:/Windows/system32/calc.exe')).toEqual({ action: 'deny' });
		expect(contents.open('javascript:alert(1)')).toEqual({ action: 'deny' });
		expect(shell.openExternal).toHaveBeenCalledTimes(1);
	});

	it('opens navigations to other origins externally instead of leaving the app', () => {
		const contents = fakeWebContents('http://127.0.0.1:5173/');
		const shell = fakeShell();
		externalLinks.installExternalLinkHandler(contents.webContents, shell);

		const external = contents.navigate('https://civitai.com/models/58390');
		expect(external.preventDefault).toHaveBeenCalledTimes(1);
		expect(shell.openExternal).toHaveBeenCalledWith('https://civitai.com/models/58390');

		const legacy = contents.navigate('https://example.com/', { legacy: true });
		expect(legacy.preventDefault).toHaveBeenCalledTimes(1);
		expect(shell.openExternal).toHaveBeenLastCalledWith('https://example.com/');
	});

	it('leaves navigations inside the app alone', () => {
		const contents = fakeWebContents('http://127.0.0.1:5173/');
		const shell = fakeShell();
		externalLinks.installExternalLinkHandler(contents.webContents, shell);

		const reload = contents.navigate('http://127.0.0.1:5173/index.html');
		expect(reload.preventDefault).not.toHaveBeenCalled();
		const file = contents.navigate('file:///C:/app/dist/index.html');
		expect(file.preventDefault).not.toHaveBeenCalled();
		expect(shell.openExternal).not.toHaveBeenCalled();
	});

	it('reports a failure to open the browser without throwing', async () => {
		const contents = fakeWebContents('file:///C:/app/dist/index.html');
		const shell = { openExternal: vi.fn(async () => Promise.reject(new Error('no browser'))) };
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		externalLinks.installExternalLinkHandler(contents.webContents, shell);

		expect(contents.open('https://civitai.com/')).toEqual({ action: 'deny' });
		await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
		expect(String(consoleError.mock.calls[0][0])).toContain('https://civitai.com/');
	});
});
