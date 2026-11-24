// Renders the notifications store (user-facing errors, warnings, info) as a stacked overlay of
// Fluent message bars, top-center above the workspace.
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

const useStyles = makeStyles({
	host: {
		position: 'fixed',
		top: tokens.spacingVerticalM,
		left: '50%',
		transform: 'translateX(-50%)',
		zIndex: 1,
		width: `min(720px, calc(100vw - ${tokens.spacingHorizontalXXL} - ${tokens.spacingHorizontalXXL}))`,
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
		<div className={styles.host}>
			<MessageBarGroup animate="both" className={styles.group}>
				{notifications.map((notification) => (
					<NotificationBar key={notification.id} notification={notification} />
				))}
			</MessageBarGroup>
		</div>
	);
}
