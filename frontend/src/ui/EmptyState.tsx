// THE empty state of the app (the Fluent 2 empty-state pattern): an icon on a round badge, a title, what to do next and
// optional actions, centered in the space it stands for. Every section and region uses it: the prompt board (no
// categories, no match), the viewer (no outputs, none selected, a missing picture, no details), the detail panels of
// Models / Images / Characters (nothing picked) and the character gallery (no characters, no match). Pure view.
import { makeStyles, mergeClasses, tokens, typographyStyles } from '@fluentui/react-components';
import type { FluentIcon } from '@fluentui/react-icons';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: tokens.spacingVerticalM,
		maxWidth: '100%',
		marginLeft: 'auto',
		marginRight: 'auto',
		paddingTop: tokens.spacingVerticalXXL,
		paddingBottom: tokens.spacingVerticalXXL,
		paddingLeft: tokens.spacingHorizontalL,
		paddingRight: tokens.spacingHorizontalL,
		boxSizing: 'border-box',
		textAlign: 'center',
	},
	small: {
		gap: tokens.spacingVerticalS,
		paddingTop: tokens.spacingVerticalL,
		paddingBottom: tokens.spacingVerticalL,
	},
	// The icon on a round badge: neutral, or brand-tinted for a call to action (`emphasis`).
	badge: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flexShrink: 0,
		width: '64px',
		height: '64px',
		borderRadius: tokens.borderRadiusCircular,
		backgroundColor: tokens.colorNeutralBackground5,
		color: tokens.colorNeutralForeground3,
		fontSize: tokens.fontSizeHero700,
	},
	smallBadge: {
		width: '48px',
		height: '48px',
		fontSize: tokens.fontSizeHero700,
	},
	emphasis: {
		backgroundColor: tokens.colorBrandBackground2,
		color: tokens.colorBrandForeground2,
	},
	title: {
		...typographyStyles.subtitle2,
		margin: 0,
		color: tokens.colorNeutralForeground1,
		overflowWrap: 'anywhere',
	},
	smallTitle: {
		...typographyStyles.body1Strong,
		color: tokens.colorNeutralForeground2,
	},
	body: {
		...typographyStyles.body1,
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		maxWidth: '48ch',
		color: tokens.colorNeutralForeground2,
		'& p': {
			margin: 0,
		},
	},
	smallBody: {
		...typographyStyles.caption1,
		color: tokens.colorNeutralForeground3,
	},
	actions: {
		display: 'flex',
		flexWrap: 'wrap',
		justifyContent: 'center',
		gap: tokens.spacingHorizontalS,
		maxWidth: '100%',
	},
});

export type EmptyStateProps = {
	/** The icon of the badge (an outline Fluent icon). */
	icon: FluentIcon;
	title: ReactNode;
	/** The title's element: a heading (default h2) where it starts a part of the page, plain text ('p') inside a part
	 *  that already has its own heading. */
	titleAs?: 'h2' | 'h3' | 'p';
	/** What to do next: a text, or several paragraphs (<p>). */
	children?: ReactNode;
	/** Buttons (or another control group) under the text. */
	actions?: ReactNode;
	/** A call to action (a first run): the brand-tinted badge. */
	emphasis?: boolean;
	/** The state replaces content in place: announce it when it appears (role status). */
	live?: boolean;
	/** 'small' in narrow or secondary places (the viewer's details tab): a smaller badge, caption text. */
	size?: 'medium' | 'small';
	className?: string;
};

export function EmptyState({
	icon: Icon,
	title,
	titleAs: Title = 'h2',
	children,
	actions,
	emphasis = false,
	live = false,
	size = 'medium',
	className,
}: EmptyStateProps): JSX.Element {
	const styles = useStyles();
	const small = size === 'small';
	return (
		<div className={mergeClasses(styles.root, small && styles.small, className)} role={live ? 'status' : undefined}>
			<span className={mergeClasses(styles.badge, small && styles.smallBadge, emphasis && styles.emphasis)} aria-hidden>
				<Icon />
			</span>
			<Title className={mergeClasses(styles.title, small && styles.smallTitle)}>{title}</Title>
			{children ? <div className={mergeClasses(styles.body, small && styles.smallBody)}>{children}</div> : null}
			{actions ? <div className={styles.actions}>{actions}</div> : null}
		</div>
	);
}
