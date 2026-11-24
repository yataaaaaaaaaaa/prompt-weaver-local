import { describe, expect, it } from 'vitest';
import { OWNS_KEYS_ATTRIBUTE } from '../app/commands';
import { ariaKeyShortcuts, ownsKeysProps, shortcutLabel, withShortcut } from './keyboard';

describe('shortcut hints', () => {
	it('formats the keymap accelerators of a command', () => {
		expect(shortcutLabel('reorganize-categories')).toBe('Ctrl+O');
		expect(shortcutLabel('output-previous')).toBe('← / ↑');
		expect(ariaKeyShortcuts('reorganize-categories')).toBe('Control+O');
		expect(ariaKeyShortcuts('output-next')).toBe('ArrowRight ArrowDown');
	});

	it('appends the shortcut to a tooltip label', () => {
		expect(withShortcut('Undo', 'undo')).toBe('Undo (Ctrl+Z)');
	});

	it('marks key-owning elements with the attribute the command dispatcher checks', () => {
		expect(ownsKeysProps).toEqual({ [OWNS_KEYS_ATTRIBUTE]: '' });
	});
});
