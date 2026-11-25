// Renders the notifications store (user-facing errors, warnings, info) as toasts: a stack of Fluent message bars
// (intent colors and icons, announced to screen readers) at the bottom-end corner of the window, the Fluent 2 toast
// position. Fixed above every workspace window (whose z-indexes stay inside the isolated workspace surface) and never
// over the app bar; Fluent portals (menus, dialogs, tooltips) stay above it. The newest toast is the lowest one.
import {
	Button,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarGroup,
	MessageBarTitle,
	tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useNotificationsStore, type AppNotification } from '../stores/notificationsStore';

/** Toasts are narrower than the window so they cover as little as possible (multi-line messages wrap). */
const TOAST_MAX_WIDTH = '440px';

const useStyles = makeStyles({
	host: {
		position: 'fixed',
		right: tokens.spacingHorizontalXXL,
		bottom: tokens.spacingVerticalXXL,
		zIndex: 1,
		width: `min(${TOAST_MAX_WIDTH}, calc(100vw - ${tokens.spacingHorizontalXXL} - ${tokens.spacingHorizontalXXL}))`,
		pointerEvents: 'none',
	},
	group: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
	},
	bar: {
		pointerEvents: 'auto',
		boxShadow: tokens.shadow16,
	},
});

function NotificationBar({ notification }: { notification: AppNotification }): JSX.Element {
	const styles = useStyles();
	const dismiss = useNotificationsStore((state) => state.dismiss);
	return (
		<MessageBar intent={notification.intent} layout="multiline" className={styles.bar}>
			<MessageBarBody>
				{notification.title ? <MessageBarTitle>{notification.title}</MessageBarTitle> : null}
				{notification.message}
			</MessageBarBody>
			<MessageBarActions
				containerAction={
					<Button
						appearance="transparent"
						aria-label="Dismiss"
						icon={<DismissRegular />}
						onClick={() => dismiss(notification.id)}
					/>
				}
			/>
		</MessageBar>
	);
}

export function NotificationsHost(): JSX.Element | null {
	const styles = useStyles();
	const notifications = useNotificationsStore((state) => state.notifications);
	if (notifications.length === 0) {
		return null;
	}
	return (
		<div role="region" aria-label="Notifications" className={styles.host}>
			<MessageBarGroup animate="both" className={styles.group}>
				{notifications.map((notification) => (
					<NotificationBar key={notification.id} notification={notification} />
				))}
			</MessageBarGroup>
		</div>
	);
}
