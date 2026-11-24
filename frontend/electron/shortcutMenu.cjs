// Electron "Shortcuts" menu: the keymap entries flagged `menu: true` (src/app/keymap.json is the single
// owner of the bindings; the renderer dispatches the same command ids through src/app/commands.ts).

/**
 * @param {Array<{ command: string; accelerator: string; label: string; menu: boolean }>} keymap
 * @param {(command: string) => void} sendCommand
 */
function shortcutMenuItems(keymap, sendCommand) {
	return keymap
		.filter((binding) => binding.menu)
		.map((binding) => ({
			label: binding.label,
			accelerator: binding.accelerator,
			click: () => sendCommand(binding.command),
		}));
}

module.exports = { shortcutMenuItems };
