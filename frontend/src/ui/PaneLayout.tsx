// Layout primitives of the tool panes rendered inside a FloatingPane body (which scrolls but has no padding):
// PaneContent = padded column; PaneSection = titled section (heading + optional header actions) separated
// from the previous one by a divider stroke; PaneGrid = two-column field grid. Shared by every pane view.
import { makeStyles, mergeClasses, Subtitle2, tokens, useId } from '@fluentui/react-components';
import type { CSSProperties, ReactNode } from 'react';

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
	// Fields keep their own height: a hint under one field never stretches the field next to it.
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
		alignItems: 'start',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalS,
	},
	// Two columns while each gets at least --pane-grid-min-column, else one (never more than two).
	responsive: {
		gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(var(--pane-grid-min-column), calc((100% - ${tokens.spacingHorizontalM}) / 2))), 1fr))`,
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

export type PaneGridProps = {
	children: ReactNode;
	/** Narrowest column (CSS length, e.g. '160px'): below two of these the fields stack in one column, so labels and
	 *  values never wrap or get cut in a narrow pane. Without it the grid always has two columns. */
	minColumnWidth?: string;
};

/** Two equal columns of form fields (one in a narrow pane when `minColumnWidth` is given). */
export function PaneGrid({ children, minColumnWidth }: PaneGridProps): JSX.Element {
	const styles = useStyles();
	return (
		<div
			className={mergeClasses(styles.grid, minColumnWidth !== undefined && styles.responsive)}
			style={minColumnWidth !== undefined ? ({ '--pane-grid-min-column': minColumnWidth } as CSSProperties) : undefined}
		>
			{children}
		</div>
	);
}
