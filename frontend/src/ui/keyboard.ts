// Keyboard hints for views: shortcut labels and aria-keyshortcuts values derived from the keymap, and the
// props marking an element that handles plain keys itself. Bindings, parsing and the key-ownership rule
// live in src/app/commands.ts.
import { KEY_BINDINGS, OWNS_KEYS_ATTRIBUTE, parseAccelerator, type AppCommand, type ParsedAccelerator } from '../app/commands';

const KEY_SYMBOLS: Readonly<Record<string, string>> = {
	ArrowLeft: '←',
	ArrowRight: '→',
	ArrowUp: '↑',
	ArrowDown: '↓',
};

function accelerators(command: AppCommand): ParsedAccelerator[] {
	return KEY_BINDINGS.filter((binding) => binding.command === command).map((binding) => parseAccelerator(binding.accelerator));
}

function format(accelerator: ParsedAccelerator, control: string, key: string): string {
	return [accelerator.commandOrControl && control, accelerator.alt && 'Alt', accelerator.shift && 'Shift', key].filter(Boolean).join('+');
}

/** Human-readable shortcut(s) of a command ("Ctrl+O", "← / ↑"), or null when it has none. */
export function shortcutLabel(command: AppCommand): string | null {
	const labels = accelerators(command).map((accelerator) => format(accelerator, 'Ctrl', KEY_SYMBOLS[accelerator.keyName] ?? accelerator.keyName));
	return labels.length > 0 ? labels.join(' / ') : null;
}

/** Value for the aria-keyshortcuts attribute ("Control+O", DOM key names), or undefined without a binding. */
export function ariaKeyShortcuts(command: AppCommand): string | undefined {
	const keys = accelerators(command).map((accelerator) => format(accelerator, 'Control', accelerator.keyName));
	return keys.length > 0 ? keys.join(' ') : undefined;
}

/** Tooltip text with the shortcut hint: "Reorganize categories (Ctrl+O)". */
export function withShortcut(label: string, command: AppCommand): string {
	const shortcut = shortcutLabel(command);
	return shortcut ? `${label} (${shortcut})` : label;
}

/** Spread on an element that handles plain (unmodified) keys itself, e.g. the window move/resize
 *  handles: global shortcuts then leave those keys alone while it has focus. */
export const ownsKeysProps: Readonly<Record<typeof OWNS_KEYS_ATTRIBUTE, string>> = { [OWNS_KEYS_ATTRIBUTE]: '' };
