// App commands: the single dispatch point for keyboard shortcuts and Electron menu commands, and the one
// place deciding which key presses become commands (bindings, editable targets, keys owned by the focused
// widget). Key bindings live in ./keymap.json (also read by frontend/electron/main.cjs to build the menu).
import keymap from './keymap.json';
import { useCategoriesStore } from '../stores/categoriesStore';
import { useGenerationStore } from '../stores/generationStore';
import { reportError } from '../stores/notificationsStore';
import { useOutputsStore } from '../stores/outputsStore';
import { useUndoStore } from '../stores/undoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export const APP_COMMANDS = [
	'generate',
	'toggle-continuous-generate',
	'toggle-visibility',
	'reorganize-categories',
	'undo',
	'output-previous',
	'output-next',
] as const;

export type AppCommand = (typeof APP_COMMANDS)[number];

export type KeyBinding = {
	command: AppCommand;
	/** Electron accelerator syntax ("CommandOrControl+G", "ArrowLeft"). */
	accelerator: string;
	label: string;
	/** Also exposed in the Electron "Shortcuts" menu. */
	menu: boolean;
	/** Still active while focus is in an input/textarea/contenteditable. */
	allowInEditable: boolean;
};

export const KEY_BINDINGS = keymap as KeyBinding[];

export type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function isAppCommand(value: string): value is AppCommand {
	return (APP_COMMANDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Editable targets
// ---------------------------------------------------------------------------

/** Input types that do not take text. */
const NON_EDITABLE_INPUT_TYPES: ReadonlySet<string> = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio']);

function isContentEditable(element: Element): boolean {
	if ((element as HTMLElement).isContentEditable) {
		return true;
	}
	// jsdom does not implement isContentEditable.
	const host = element.closest('[contenteditable]');
	return host !== null && host.getAttribute('contenteditable') !== 'false';
}

/** input (except buttons/checkboxes/radios), textarea, select or contenteditable. */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).tagName !== 'string' || typeof (target as Element).closest !== 'function') {
		return false;
	}
	const element = target as Element;
	const tag = element.tagName.toLowerCase();
	if (tag === 'textarea' || tag === 'select') {
		return true;
	}
	if (tag === 'input') {
		return !NON_EDITABLE_INPUT_TYPES.has(((element as HTMLInputElement).type || 'text').toLowerCase());
	}
	return isContentEditable(element);
}

// ---------------------------------------------------------------------------
// Keys owned by the focused widget
// ---------------------------------------------------------------------------

/** Marks an element that handles plain (unmodified) keys itself, e.g. the window move/resize handles
 *  (views spread `ownsKeysProps` from src/ui/keyboard.ts). */
export const OWNS_KEYS_ATTRIBUTE = 'data-owns-keys';

/** ARIA composite widgets that move focus or change values with arrow keys (Fluent menus, toolbars,
 *  dropdowns, sliders, radio groups, tab lists, trees, grids). */
const KEY_OWNER_ROLES = ['combobox', 'grid', 'listbox', 'menu', 'menubar', 'radiogroup', 'slider', 'spinbutton', 'tablist', 'toolbar', 'tree', 'treegrid'];

const KEY_OWNER_SELECTOR = [`[${OWNS_KEYS_ATTRIBUTE}]`, ...KEY_OWNER_ROLES.map((role) => `[role="${role}"]`)].join(', ');

/** True when a plain key press belongs to the focused widget (marked with OWNS_KEYS_ATTRIBUTE or inside a
 *  composite widget) rather than to the global shortcuts. Modified presses (Ctrl/Cmd/Alt) never do. */
export function isKeyOwnedByFocusedWidget(event: Pick<KeyboardEvent, 'target' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}
	const target = event.target;
	return target instanceof Element && target.closest(KEY_OWNER_SELECTOR) != null;
}

// ---------------------------------------------------------------------------
// Key bindings
// ---------------------------------------------------------------------------

export type ParsedAccelerator = {
	/** KeyboardEvent.key, lower-case ('g', 'arrowleft'). */
	key: string;
	/** The key as written in the accelerator ('G', 'ArrowLeft'), for display. */
	keyName: string;
	commandOrControl: boolean;
	shift: boolean;
	alt: boolean;
};

const COMMAND_OR_CONTROL = new Set(['commandorcontrol', 'cmdorctrl', 'control', 'ctrl', 'command', 'cmd', 'super', 'meta']);

/** Electron accelerator key names -> KeyboardEvent.key (lower-case). */
const KEY_ALIASES: ReadonlyMap<string, string> = new Map([
	['left', 'arrowleft'],
	['right', 'arrowright'],
	['up', 'arrowup'],
	['down', 'arrowdown'],
	['space', ' '],
	['esc', 'escape'],
	['return', 'enter'],
	['plus', '+'],
]);

function normalizeKey(key: string): string {
	const lower = key.toLowerCase();
	return KEY_ALIASES.get(lower) ?? lower;
}

export function parseAccelerator(accelerator: string): ParsedAccelerator {
	const parts = accelerator.split('+');
	// "CommandOrControl+Plus" style; a trailing empty part means the key itself is '+'.
	const rawKey = parts.length > 1 && parts[parts.length - 1] === '' ? '+' : (parts.pop() ?? '');
	const modifiers = parts.filter(Boolean).map((part) => part.toLowerCase());
	return {
		key: normalizeKey(rawKey),
		keyName: rawKey,
		commandOrControl: modifiers.some((modifier) => COMMAND_OR_CONTROL.has(modifier)),
		shift: modifiers.includes('shift'),
		alt: modifiers.includes('alt') || modifiers.includes('option'),
	};
}

const PARSED_BINDINGS = KEY_BINDINGS.map((binding) => ({ binding, accelerator: parseAccelerator(binding.accelerator) }));

/** Matches KEY_BINDINGS (CommandOrControl = Ctrl or Meta; Alt never matches; letter keys are
 *  case-insensitive; Shift must match the binding). Bindings not allowed in editable targets are
 *  skipped when `editableTarget` is true. */
export function keyEventToCommand(event: KeyLike, editableTarget: boolean): AppCommand | null {
	if (event.altKey) {
		return null;
	}
	const key = normalizeKey(event.key);
	const commandOrControl = event.ctrlKey || event.metaKey;
	for (const { binding, accelerator } of PARSED_BINDINGS) {
		if (
			!accelerator.alt &&
			accelerator.key === key &&
			accelerator.commandOrControl === commandOrControl &&
			accelerator.shift === event.shiftKey &&
			(!editableTarget || binding.allowInEditable)
		) {
			return binding.command;
		}
	}
	return null;
}

/** The command a window keydown runs, or null: plain keys owned by the focused widget are left to it and
 *  bindings that are not allowed in editable targets are skipped there. */
export function commandForKeyEvent(event: KeyLike & Pick<KeyboardEvent, 'target'>): AppCommand | null {
	if (isKeyOwnedByFocusedWidget(event)) {
		return null;
	}
	return keyEventToCommand(event, isEditableTarget(event.target));
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** An Electron menu accelerator and the renderer keydown handler both fire for one key press. */
export const COMMAND_DEDUPE_MS = 200;

/** Where a command comes from: a renderer keydown, or the Electron menu (its accelerator or a click). */
export type CommandSource = 'keyboard' | 'menu';

const COMMAND_HANDLERS: Record<AppCommand, () => unknown> = {
	generate: () => useGenerationStore.getState().generate(),
	'toggle-continuous-generate': () => useGenerationStore.getState().toggleContinuous(),
	'toggle-visibility': () => useWorkspaceStore.getState().cycleVisibilityMode(),
	'reorganize-categories': () => useCategoriesStore.getState().reorganize(),
	undo: () => useUndoStore.getState().undo(),
	'output-previous': () => useOutputsStore.getState().previous(),
	'output-next': () => useOutputsStore.getState().next(),
};

let lastCommand: { command: AppCommand; source: CommandSource; at: number } | null = null;

/** Dispatches to store actions. One key press can reach the app twice, through the renderer keydown handler and
 *  through the Electron menu accelerator: the same command from the OTHER source within 200 ms is that echo and is
 *  ignored. Repeated presses from one source always run (Ctrl+H twice cycles twice, a held arrow key keeps
 *  navigating). */
export function runCommand(command: AppCommand, source: CommandSource = 'keyboard'): void {
	const now = Date.now();
	if (lastCommand && lastCommand.command === command && lastCommand.source !== source && now - lastCommand.at < COMMAND_DEDUPE_MS) {
		return;
	}
	lastCommand = { command, source, at: now };
	try {
		const result = COMMAND_HANDLERS[command]();
		if (result instanceof Promise) {
			result.catch((error: unknown) => reportError(error, `Command '${command}' failed`));
		}
	} catch (error) {
		reportError(error, `Command '${command}' failed`);
	}
}

/** Test helper: forget the last dispatched command (dedupe window). */
export function resetCommandsForTests(): void {
	lastCommand = null;
}
