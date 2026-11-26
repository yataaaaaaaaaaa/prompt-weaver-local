// Toolbar layout of the full-page library sections (Models, Images), rendered in SectionLayout's header next to the
// section title: a first row with the view switch (a TabList), the search box and the section commands (right
// aligned), and below it the filter row of the shown view (a labelled group; omitted when the view has none). Filters
// put their label left of the control (useFilterStyles), so the header stays two rows high. Pure layout view.
import { makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		flex: '1 1 auto',
		minWidth: 0,
	},
	row: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	commands: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
		marginLeft: 'auto',
	},
	filters: {
		display: 'flex',
		alignItems: 'flex-start',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalL,
		rowGap: tokens.spacingVerticalS,
		minWidth: 0,
	},
});

/** Classes of the filter controls of a SectionToolbar row. */
export const useFilterStyles = makeStyles({
	search: {
		flex: '1 1 240px',
		minWidth: '200px',
		maxWidth: '480px',
	},
	// The label left of the control: a compact row instead of labels on top.
	field: {
		gridTemplateColumns: 'auto minmax(0, 1fr)',
	},
	dropdown: {
		minWidth: '160px',
		maxWidth: '220px',
	},
	hint: {
		color: tokens.colorNeutralForeground3,
	},
});

export type SectionToolbarProps = {
	/** The view switch (TabList). */
	views: ReactNode;
	/** The search box of the shown view (with SECTION_SEARCH_ATTRIBUTE), if it has one. */
	search?: ReactNode;
	/** Section commands, right aligned. */
	commands?: ReactNode;
	/** The filter controls of the shown view (none: no filter row). */
	filters?: ReactNode;
	/** Accessible name of the filter row (e.g. 'Model filters'). */
	filtersLabel: string;
};

export function SectionToolbar({ views, search, commands, filters, filtersLabel }: SectionToolbarProps): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.root}>
			<div className={styles.row}>
				{views}
				{search}
				{commands ? <div className={styles.commands}>{commands}</div> : null}
			</div>
			{filters ? (
				<div className={styles.filters} role="group" aria-label={filtersLabel}>
					{filters}
				</div>
			) : null}
		</div>
	);
}
