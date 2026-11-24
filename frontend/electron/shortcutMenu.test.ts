// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { KEY_BINDINGS } from '../src/app/commands';
import keymap from '../src/app/keymap.json';
import shortcutMenu from './shortcutMenu.cjs';

describe('Electron Shortcuts menu', () => {
	it('lists the keymap entries flagged for the menu and sends their commands', () => {
		const sendCommand = vi.fn();
		const items = shortcutMenu.shortcutMenuItems(keymap, sendCommand);
		const expected = KEY_BINDINGS.filter((binding) => binding.menu);

		expect(items.map(({ label, accelerator }) => ({ label, accelerator }))).toEqual(
			expected.map(({ label, accelerator }) => ({ label, accelerator })),
		);
		items.forEach((item) => item.click());
		expect(sendCommand.mock.calls.map(([command]) => command)).toEqual(expected.map((binding) => binding.command));
	});

	it('no longer offers the removed "Compute indirectly disabled" command', () => {
		const items = shortcutMenu.shortcutMenuItems(keymap, () => undefined);
		expect(items.some((item) => /indirectly/i.test(item.label))).toBe(false);
	});
});
