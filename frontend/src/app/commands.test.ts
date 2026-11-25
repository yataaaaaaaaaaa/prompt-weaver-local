import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCategoriesStore } from '../stores/categoriesStore';
import { useGenerationStore } from '../stores/generationStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useOutputsStore } from '../stores/outputsStore';
import { useUndoStore } from '../stores/undoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import {
	APP_COMMANDS,
	COMMAND_DEDUPE_MS,
	commandForKeyEvent,
	isAppCommand,
	isEditableTarget,
	isKeyOwnedByFocusedWidget,
	KEY_BINDINGS,
	keyEventToCommand,
	OWNS_KEYS_ATTRIBUTE,
	parseAccelerator,
	resetCommandsForTests,
	runCommand,
	type AppCommand,
	type KeyLike,
} from './commands';

const key = (value: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
	key: value,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

describe('keymap.json', () => {
	it('binds only known commands and every command has a binding', () => {
		for (const binding of KEY_BINDINGS) {
			expect(isAppCommand(binding.command), binding.command).toBe(true);
		}
		for (const command of APP_COMMANDS) {
			expect(KEY_BINDINGS.some((binding) => binding.command === command), command).toBe(true);
		}
	});

	it('has no two bindings on the same accelerator', () => {
		const accelerators = KEY_BINDINGS.map((binding) => JSON.stringify(parseAccelerator(binding.accelerator)));
		expect(new Set(accelerators).size).toBe(accelerators.length);
	});
});

describe('parseAccelerator', () => {
	it('understands Electron accelerators', () => {
		expect(parseAccelerator('CommandOrControl+G')).toEqual({ key: 'g', keyName: 'G', commandOrControl: true, shift: false, alt: false });
		expect(parseAccelerator('CmdOrCtrl+Shift+Z')).toEqual({ key: 'z', keyName: 'Z', commandOrControl: true, shift: true, alt: false });
		expect(parseAccelerator('ArrowLeft')).toEqual({ key: 'arrowleft', keyName: 'ArrowLeft', commandOrControl: false, shift: false, alt: false });
		expect(parseAccelerator('Left').key).toBe('arrowleft');
		expect(parseAccelerator('Alt+Space')).toEqual({ key: ' ', keyName: 'Space', commandOrControl: false, shift: false, alt: true });
		expect(parseAccelerator('CommandOrControl++').key).toBe('+');
	});
});

describe('keyEventToCommand', () => {
	const table: [KeyLike, boolean, AppCommand | null][] = [
		[key('g', { ctrlKey: true }), false, 'generate'],
		[key('G', { ctrlKey: true }), false, 'generate'],
		[key('g', { metaKey: true }), false, 'generate'],
		[key('g', { ctrlKey: true }), true, 'generate'],
		[key('t', { ctrlKey: true }), true, 'toggle-continuous-generate'],
		[key('h', { ctrlKey: true }), false, 'toggle-visibility'],
		[key('h', { ctrlKey: true }), true, null],
		[key('o', { ctrlKey: true }), false, 'reorganize-categories'],
		[key('z', { ctrlKey: true }), false, 'undo'],
		[key('z', { ctrlKey: true }), true, null],
		[key('z', { ctrlKey: true, shiftKey: true }), false, null],
		[key('ArrowLeft'), false, 'output-previous'],
		[key('ArrowUp'), false, 'output-previous'],
		[key('ArrowRight'), false, 'output-next'],
		[key('ArrowDown'), false, 'output-next'],
		[key('ArrowLeft'), true, null],
		[key('ArrowLeft', { ctrlKey: true }), false, null],
		[key('g'), false, null],
		[key('g', { ctrlKey: true, altKey: true }), false, null],
		[key('ArrowRight', { altKey: true }), false, null],
		[key('x', { ctrlKey: true }), false, null],
	];

	it.each(table)('%o (editable: %s) -> %s', (event, editable, expected) => {
		expect(keyEventToCommand(event, editable)).toBe(expected);
	});
});

describe('isEditableTarget', () => {
	function element(html: string): Element {
		const container = document.createElement('div');
		container.innerHTML = html;
		document.body.append(container);
		return container.querySelector('[data-target]') ?? container.firstElementChild!;
	}

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it.each([
		['<input data-target />', true],
		['<input type="text" data-target />', true],
		['<input type="number" data-target />', true],
		['<input type="range" data-target />', true],
		['<input type="button" data-target />', false],
		['<input type="submit" data-target />', false],
		['<input type="checkbox" data-target />', false],
		['<input type="radio" data-target />', false],
		['<textarea data-target></textarea>', true],
		['<select data-target></select>', true],
		['<div contenteditable="true" data-target></div>', true],
		['<div contenteditable=""><span data-target>x</span></div>', true],
		['<div contenteditable="false" data-target></div>', false],
		['<input role="combobox" data-target />', true],
		['<button data-target>Next</button>', false],
		['<div data-target></div>', false],
	])('%s -> %s', (html, expected) => {
		expect(isEditableTarget(element(html))).toBe(expected);
	});

	it('handles non-element targets', () => {
		expect(isEditableTarget(null)).toBe(false);
		expect(isEditableTarget(window)).toBe(false);
		expect(isEditableTarget(document)).toBe(false);
	});
});

describe('isKeyOwnedByFocusedWidget', () => {
	function keyFrom(target: Element, modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>> = {}) {
		return { target, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
	}

	it('gives plain keys to elements marked as key owners and to composite widgets', () => {
		const handle = document.createElement('button');
		handle.setAttribute(OWNS_KEYS_ATTRIBUTE, '');
		const toolbar = document.createElement('div');
		toolbar.setAttribute('role', 'toolbar');
		const toolbarButton = document.createElement('button');
		toolbar.appendChild(toolbarButton);

		expect(isKeyOwnedByFocusedWidget(keyFrom(handle))).toBe(true);
		expect(isKeyOwnedByFocusedWidget(keyFrom(toolbarButton))).toBe(true);
	});

	it('leaves other targets and modified keys to the global shortcuts', () => {
		const button = document.createElement('button');
		const menuItem = document.createElement('div');
		const menu = document.createElement('div');
		menu.setAttribute('role', 'menu');
		menu.appendChild(menuItem);

		expect(isKeyOwnedByFocusedWidget(keyFrom(button))).toBe(false);
		expect(isKeyOwnedByFocusedWidget(keyFrom(menuItem, { ctrlKey: true }))).toBe(false);
		expect(isKeyOwnedByFocusedWidget({ target: null, ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
	});
});

describe('commandForKeyEvent', () => {
	const event = (target: Element, value: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}) => ({ ...key(value, modifiers), target });

	it('combines key ownership, editable targets and the bindings', () => {
		const handle = document.createElement('button');
		handle.setAttribute(OWNS_KEYS_ATTRIBUTE, '');
		const input = document.createElement('input');
		const plain = document.createElement('div');

		expect(commandForKeyEvent(event(plain, 'ArrowRight'))).toBe('output-next');
		expect(commandForKeyEvent(event(handle, 'ArrowRight'))).toBeNull();
		expect(commandForKeyEvent(event(handle, 'g', { ctrlKey: true }))).toBe('generate');
		expect(commandForKeyEvent(event(input, 'ArrowRight'))).toBeNull();
		expect(commandForKeyEvent(event(input, 'g', { ctrlKey: true }))).toBe('generate');
		expect(commandForKeyEvent(event(input, 'o', { ctrlKey: true }))).toBeNull();
	});
});

describe('runCommand', () => {
	beforeEach(() => {
		resetCommandsForTests();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function stubActions() {
		const spies = {
			generate: vi.fn(async () => undefined),
			toggleContinuous: vi.fn(async () => undefined),
			cycleVisibilityMode: vi.fn(),
			reorganize: vi.fn(),
			undo: vi.fn(async () => undefined),
			previous: vi.fn(async () => undefined),
			next: vi.fn(async () => undefined),
		};
		useGenerationStore.setState({ generate: spies.generate, toggleContinuous: spies.toggleContinuous });
		useWorkspaceStore.setState({ cycleVisibilityMode: spies.cycleVisibilityMode });
		useCategoriesStore.setState({ reorganize: spies.reorganize });
		useUndoStore.setState({ undo: spies.undo });
		useOutputsStore.setState({ previous: spies.previous, next: spies.next });
		return spies;
	}

	it('dispatches every command to its store action', () => {
		const spies = stubActions();
		const expected: Record<AppCommand, ReturnType<typeof vi.fn>> = {
			generate: spies.generate,
			'toggle-continuous-generate': spies.toggleContinuous,
			'toggle-visibility': spies.cycleVisibilityMode,
			'reorganize-categories': spies.reorganize,
			undo: spies.undo,
			'output-previous': spies.previous,
			'output-next': spies.next,
		};
		for (const command of APP_COMMANDS) {
			runCommand(command);
			expect(expected[command], command).toHaveBeenCalledTimes(1);
		}
	});

	it('ignores the echo of a key press from the other source (keydown + Electron menu) within 200 ms', () => {
		const spies = stubActions();
		runCommand('generate', 'keyboard');
		vi.advanceTimersByTime(COMMAND_DEDUPE_MS - 1);
		runCommand('generate', 'menu');
		expect(spies.generate).toHaveBeenCalledTimes(1);

		// The menu first, then the keydown echo.
		vi.advanceTimersByTime(COMMAND_DEDUPE_MS);
		runCommand('generate', 'menu');
		runCommand('generate', 'keyboard');
		expect(spies.generate).toHaveBeenCalledTimes(2);

		// Another command in between: not an echo.
		vi.advanceTimersByTime(COMMAND_DEDUPE_MS);
		runCommand('generate', 'keyboard');
		runCommand('output-next', 'keyboard');
		runCommand('generate', 'menu');
		expect(spies.generate).toHaveBeenCalledTimes(4);

		// Later than 200 ms: a new press.
		vi.advanceTimersByTime(COMMAND_DEDUPE_MS);
		runCommand('generate', 'keyboard');
		expect(spies.generate).toHaveBeenCalledTimes(5);
	});

	it('runs every press from the same source, however fast (Ctrl+H twice, a held arrow key)', () => {
		const spies = stubActions();
		runCommand('toggle-visibility', 'keyboard');
		runCommand('toggle-visibility', 'keyboard');
		expect(spies.cycleVisibilityMode).toHaveBeenCalledTimes(2);

		runCommand('output-next');
		runCommand('output-next');
		runCommand('output-next');
		expect(spies.next).toHaveBeenCalledTimes(3);

		runCommand('reorganize-categories', 'menu');
		runCommand('reorganize-categories', 'menu');
		expect(spies.reorganize).toHaveBeenCalledTimes(2);
	});

	it('counts an ignored echo as nothing: the next press of the first source still runs', () => {
		const spies = stubActions();
		runCommand('toggle-visibility', 'keyboard');
		runCommand('toggle-visibility', 'menu');
		runCommand('toggle-visibility', 'keyboard');
		runCommand('toggle-visibility', 'menu');
		expect(spies.cycleVisibilityMode).toHaveBeenCalledTimes(2);
	});

	it('reports failing commands', async () => {
		useCategoriesStore.setState({
			reorganize: () => {
				throw new Error('nope');
			},
		});
		useUndoStore.setState({ undo: () => Promise.reject(new Error('async nope')) });

		runCommand('reorganize-categories');
		runCommand('undo');
		await vi.runAllTimersAsync();

		expect(useNotificationsStore.getState().notifications.map((item) => item.message)).toEqual(['nope', 'async nope']);
	});
});
