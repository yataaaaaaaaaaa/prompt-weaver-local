type WindowOpenResponse = { action: 'deny' | 'allow' };
type WillNavigateEvent = { preventDefault(): void; url?: string };
/** The part of Electron's WebContents the handler uses. */
type LinkWebContents = {
	getURL(): string;
	setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse): void;
	on(event: 'will-navigate', listener: (event: WillNavigateEvent, url?: string) => void): unknown;
};
/** The part of Electron's shell the handler uses. */
type LinkShell = { openExternal(url: string): Promise<void> };
declare const externalLinks: {
	isExternalHttpUrl(url: string, appUrl?: string): boolean;
	installExternalLinkHandler(webContents: LinkWebContents, shell: LinkShell): void;
};
export = externalLinks;
