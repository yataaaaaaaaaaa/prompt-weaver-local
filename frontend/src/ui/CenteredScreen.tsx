// Full-height screens centering one message, shown instead of the workspace: CenteredScreen (the layout) and
// ErrorCard (a blocking error: danger icon, heading, details, actions on a Fluent card). Shared by the boot screen
// (spinner, startup error) and the root error boundary (render error).
import { Card, makeStyles, mergeClasses, Subtitle1, tokens, useId } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	root: {
		display: 'grid',
		placeItems: 'center',
		height: '100%',
		overflow: 'auto',
		padding: tokens.spacingHorizontalXXL,
	},
	card: {
		width: '100%',
		maxWidth: '640px',
		padding: tokens.spacingHorizontalXXL,
		rowGap: tokens.spacingVerticalL,
		boxShadow: tokens.shadow16,
	},
	wide: {
		maxWidth: '960px',
	},
	heading: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalM,
		margin: 0,
	},
	icon: {
		flexShrink: 0,
		fontSize: tokens.fontSizeHero700,
		color: tokens.colorStatusDangerForeground1,
	},
	details: {
		margin: 0,
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		color: tokens.colorNeutralForeground2,
		fontSize: tokens.fontSizeBase300,
		lineHeight: tokens.lineHeightBase300,
	},
	actions: {
		display: 'flex',
		justifyContent: 'flex-end',
		gap: tokens.spacingHorizontalS,
	},
});

export function CenteredScreen({ as: Element = 'div', children }: { as?: 'div' | 'main'; children: ReactNode }): JSX.Element {
	const styles = useStyles();
	return <Element className={styles.root}>{children}</Element>;
}

export type ErrorCardProps = {
	title: string;
	/** The error message (wrapped, selectable). */
	message: string;
	/** Extra content below the message (e.g. a stack trace). */
	children?: ReactNode;
	/** Buttons, right-aligned (the primary one last, as in Fluent dialogs). */
	actions: ReactNode;
	/** Wider card for long technical content. */
	wide?: boolean;
};

/** A blocking error, announced to assistive technology (role alert) and labelled by its heading. */
export function ErrorCard({ title, message, children, actions, wide = false }: ErrorCardProps): JSX.Element {
	const styles = useStyles();
	const headingId = useId('error-card-');
	return (
		<Card role="alert" aria-labelledby={headingId} className={mergeClasses(styles.card, wide && styles.wide)}>
			<Subtitle1 as="h1" id={headingId} className={styles.heading}>
				<ErrorCircleRegular aria-hidden className={styles.icon} />
				{title}
			</Subtitle1>
			<p className={styles.details}>{message}</p>
			{children}
			<div className={styles.actions}>{actions}</div>
		</Card>
	);
}
