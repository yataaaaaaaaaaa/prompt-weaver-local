// Wires keyboard shortcuts and Electron menu commands to the app command dispatcher.
// Which key presses become commands (bindings, editable targets, keys owned by the focused widget) and the
// dedupe live in ./commands.ts; this hook only listens.
import { useEffect } from 'react';
import { desktop } from '../services/desktop';
import { commandForKeyEvent, isAppCommand, runCommand } from './commands';

export function useGlobalShortcuts(): void {
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent): void {
			const command = commandForKeyEvent(event);
			if (command === null) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			runCommand(command);
		}

		window.addEventListener('keydown', handleKeyDown, { capture: true });
		const unsubscribeDesktop = desktop.onCommand((command) => {
			if (isAppCommand(command)) {
				runCommand(command);
			}
		});
		return () => {
			window.removeEventListener('keydown', handleKeyDown, { capture: true });
			unsubscribeDesktop();
		};
	}, []);
}
