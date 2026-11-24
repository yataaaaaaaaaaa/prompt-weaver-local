type KeymapEntry = { command: string; accelerator: string; label: string; menu: boolean };
type ShortcutMenuItem = { label: string; accelerator: string; click: () => void };
declare const shortcutMenu: {
	shortcutMenuItems(keymap: readonly KeymapEntry[], sendCommand: (command: string) => void): ShortcutMenuItem[];
};
export = shortcutMenu;
