import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandForKeyEvent, runCommand } from './commands';
import { useGlobalShortcuts } from './useGlobalShortcuts';

vi.mock('./commands', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./commands')>();
	return { ...actual, commandForKeyEvent: vi.fn(), runCommand: vi.fn() };
});

type DesktopCommandListener = (command: string) => void;

function installDesktopBridge() {
	const listeners: DesktopCommandListener[] = [];
	const unsubscribe = vi.fn();
	(window as unknown as { promptWeaverDesktop?: unknown }).promptWeaverDesktop = {
		platform: 'win32',
		pickDirectory: vi.fn(),
		pickFile: vi.fn(),
		pickFiles: vi.fn(),
		onCommand: (listener: DesktopCommandListener) => {
			listeners.push(listener);
			return unsubscribe;
		},
	};
	return { emit: (command: string) => listeners.forEach((listener) => listener(command)), unsubscribe, listeners };
}

beforeEach(() => {
	vi.mocked(commandForKeyEvent).mockReturnValue(null);
});

afterEach(() => {
	delete (window as unknown as { promptWeaverDesktop?: unknown }).promptWeaverDesktop;
});

describe('useGlobalShortcuts', () => {
	it('maps window keydown events to commands and runs them', () => {
		vi.mocked(commandForKeyEvent).mockReturnValue('sort-categories');
		renderHook(() => useGlobalShortcuts());

		const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true });
		document.body.dispatchEvent(event);

		expect(commandForKeyEvent).toHaveBeenCalledWith(event);
		expect(runCommand).toHaveBeenCalledWith('sort-categories', 'keyboard');
		expect(event.defaultPrevented).toBe(true);
	});

	it('ignores key presses that are not commands', () => {
		renderHook(() => useGlobalShortcuts());
		const input = document.createElement('input');
		document.body.appendChild(input);

		const event = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
		input.dispatchEvent(event);

		expect(commandForKeyEvent).toHaveBeenCalledWith(event);
		expect(runCommand).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		input.remove();
	});

	it('runs Electron menu commands and ignores unknown ones', () => {
		const bridge = installDesktopBridge();
		renderHook(() => useGlobalShortcuts());

		bridge.emit('cycle-create-layout');
		bridge.emit('compute-indirectly-disabled');

		expect(runCommand).toHaveBeenCalledTimes(1);
		expect(runCommand).toHaveBeenCalledWith('cycle-create-layout', 'menu');
	});

	it('removes both listeners on unmount', () => {
		vi.mocked(commandForKeyEvent).mockReturnValue('undo');
		const bridge = installDesktopBridge();
		const { unmount } = renderHook(() => useGlobalShortcuts());

		unmount();
		fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

		expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
		expect(runCommand).not.toHaveBeenCalled();
	});
});
