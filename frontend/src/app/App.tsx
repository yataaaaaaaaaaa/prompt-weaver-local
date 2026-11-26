// Application root view: boots the session once, then shows the app shell (navigation rail + task sections).
// Notifications and global keyboard shortcuts are active in every phase.
import { useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { BootScreen } from '../ui/BootScreen';
import { NotificationsHost } from '../ui/NotificationsHost';
import { AppShell } from '../shell/AppShell';
import { useGlobalShortcuts } from './useGlobalShortcuts';

export function App(): JSX.Element {
	useGlobalShortcuts();
	const ready = useSessionStore((state) => state.phase === 'ready');

	useEffect(() => {
		void useSessionStore.getState().start();
	}, []);

	return (
		<>
			{ready ? <AppShell /> : <BootScreen />}
			<NotificationsHost />
		</>
	);
}
