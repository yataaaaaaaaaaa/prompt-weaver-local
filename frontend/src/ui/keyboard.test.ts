import { describe, expect, it } from 'vitest';
import { OWNS_KEYS_ATTRIBUTE } from '../app/commands';
import { ariaKeyShortcuts, commandLabel, ownsKeysProps, shortcutLabel, withShortcut } from './keyboard';

describe('shortcut hints', () => {
	it('formats the keymap accelerators of a command', () => {
		expect(shortcutLabel('sort-categories')).toBe('Ctrl+O');
		expect(shortcutLabel('output-previous')).toBe('← / ↑');
		expect(ariaKeyShortcuts('sort-categories')).toBe('Control+O');
		expect(ariaKeyShortcuts('output-next')).toBe('ArrowRight ArrowDown');
	});

	it('appends the shortcut to a tooltip label', () => {
		expect(withShortcut('Undo', 'undo')).toBe('Undo (Ctrl+Z)');
		expect(withShortcut('Find, download and pick models', 'show-models')).toBe('Find, download and pick models (Ctrl+2)');
		expect(shortcutLabel('next-region')).toBe('F6');
		expect(shortcutLabel('previous-region')).toBe('Shift+F6');
	});

	it('names a command by its keymap label', () => {
		expect(commandLabel('cycle-create-layout')).toBe('Cycle the Create layout');
		expect(commandLabel('output-previous')).toBe('Previous output');
	});

	it('marks key-owning elements with the attribute the command dispatcher checks', () => {
		expect(ownsKeysProps).toEqual({ [OWNS_KEYS_ATTRIBUTE]: '' });
	});
});
