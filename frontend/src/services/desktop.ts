// Electron preload bridge (frontend/electron/preload.cjs exposes window.promptWeaverDesktop).
// Single owner of the bridge type. Absent in the browser (`launcher --web`): pickers resolve to
// null/[] and `isAvailable()` is false, so stores can tell the user dialogs need the desktop app.

export type FileFilter = { name: string; extensions: string[] };

export type PickOptions = {
	defaultPath?: string | null;
	title?: string;
	filters?: FileFilter[];
};

export type DesktopBridge = {
	platform: string;
	pickDirectory: (options?: PickOptions) => Promise<string | null>;
	pickFile: (options?: PickOptions) => Promise<string | null>;
	pickFiles: (options?: PickOptions) => Promise<string[]>;
	/** Electron menu commands (ids from src/app/keymap.json). Returns an unsubscribe function. */
	onCommand?: (callback: (command: string) => void) => (() => void) | void;
};

function bridge(): DesktopBridge | null {
	if (typeof window === 'undefined') {
		return null;
	}
	return (window as unknown as { promptWeaverDesktop?: DesktopBridge }).promptWeaverDesktop ?? null;
}

export const desktop = {
	isAvailable: (): boolean => bridge() != null,
	pickDirectory: async (options?: PickOptions): Promise<string | null> => (await bridge()?.pickDirectory(options)) ?? null,
	pickFile: async (options?: PickOptions): Promise<string | null> => (await bridge()?.pickFile(options)) ?? null,
	pickFiles: async (options?: PickOptions): Promise<string[]> => (await bridge()?.pickFiles(options)) ?? [],
	onCommand: (callback: (command: string) => void): (() => void) => {
		const unsubscribe = bridge()?.onCommand?.(callback);
		return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
	},
};
