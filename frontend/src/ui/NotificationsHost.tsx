// Renders the notifications store (user-facing errors, warnings, info) as toasts: a stack of Fluent message bars
// (intent colors and icons, announced to screen readers) at the bottom-end corner (the Fluent 2 toast position), above
// the app; Fluent portals (menus, dialogs, tooltips) stay above it. While Create is shown, the corner is the one left
// of the generation panel (layoutStore selectGenerationPanelInset): an error toast stays until dismissed and must
// never cover the panel's sticky Generate. The navigation rail and the Create command bar stay clear too. The newest
// toast is the lowest one. A notification with an action (e.g. 'Go to Create') shows it as a button; running it
// dismisses the toast. A 'Go to <section>' action is not offered while that section is shown.
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
import { selectGenerationPanelInset, useLayoutStore } from '../stores/layoutStore';
import { useApplicableAction, useNavigationStore } from '../stores/navigationStore';
import { useNotificationsStore, type AppNotification } from '../stores/notificationsStore';

/** Toasts are narrower than the window so they cover as little as possible (multi-line messages wrap). */
const TOAST_MAX_WIDTH = '440px';

const useStyles = makeStyles({
	host: {
		position: 'fixed',
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
	const runAction = useNotificationsStore((state) => state.runAction);
	const action = useApplicableAction(notification.action);
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
			>
				{action ? (
					<Button appearance="secondary" size="small" onClick={() => runAction(notification.id)}>
						{action.label}
					</Button>
				) : null}
			</MessageBarActions>
		</MessageBar>
	);
}

/** The toasts' distance from the end edge of the window (px, before the spacing): the generation panel's while Create is
 *  shown, else none. */
function useEndInset(): number {
	const createShown = useNavigationStore((state) => state.section === 'create');
	const panelInset = useLayoutStore(selectGenerationPanelInset);
	return createShown ? panelInset : 0;
}

export function NotificationsHost(): JSX.Element | null {
	const styles = useStyles();
	const notifications = useNotificationsStore((state) => state.notifications);
	const endInset = useEndInset();
	if (notifications.length === 0) {
		return null;
	}
	return (
		<div
			role="region"
			aria-label="Notifications"
			className={styles.host}
			style={{ right: `calc(${endInset}px + ${tokens.spacingHorizontalXXL})`, maxWidth: `calc(100vw - ${endInset}px - 2 * ${tokens.spacingHorizontalXXL})` }}
		>
			<MessageBarGroup animate="both" className={styles.group}>
				{notifications.map((notification) => (
					<NotificationBar key={notification.id} notification={notification} />
				))}
			</MessageBarGroup>
		</div>
	);
}
