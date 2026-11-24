// Layout primitives of the tool panes rendered inside a FloatingPane body (which scrolls but has no padding):
// PaneContent = padded column; PaneSection = titled section (heading + optional header actions) separated
// from the previous one by a divider stroke; PaneGrid = two-column field grid. Shared by every pane view.
import { makeStyles, Subtitle2, tokens, useId } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	content: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		paddingTop: tokens.spacingVerticalM,
		paddingBottom: tokens.spacingVerticalL,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		boxSizing: 'border-box',
		minWidth: 0,
	},
	section: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
		':not(:first-child)': {
			paddingTop: tokens.spacingVerticalM,
			borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		},
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	title: {
		margin: 0,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
		marginLeft: 'auto',
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalS,
	},
});

export function PaneContent({ children }: { children: ReactNode }): JSX.Element {
	const styles = useStyles();
	return <div className={styles.content}>{children}</div>;
}

export type PaneSectionProps = {
	title: string;
	/** Buttons shown on the right of the heading. */
	actions?: ReactNode;
	children?: ReactNode;
};

export function PaneSection({ title, actions, children }: PaneSectionProps): JSX.Element {
	const styles = useStyles();
	const headingId = useId('pane-section-');
	return (
		<section className={styles.section} aria-labelledby={headingId}>
			<div className={styles.header}>
				<Subtitle2 as="h3" id={headingId} className={styles.title}>
					{title}
				</Subtitle2>
				{actions ? <div className={styles.actions}>{actions}</div> : null}
			</div>
			{children}
		</section>
	);
}

/** Two equal columns of form fields. */
export function PaneGrid({ children }: { children: ReactNode }): JSX.Element {
	const styles = useStyles();
	return <div className={styles.grid}>{children}</div>;
}
