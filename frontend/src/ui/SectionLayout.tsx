// The layout of the full-page library sections (Models, Images, Characters): a header row (the section title, then
// its search, filters and commands), and below it the results (a grid that scrolls on its own) next to a detail panel
// of the selected item (scrolls on its own; shows `emptyDetail` while nothing is selected). One layout for the three
// sections, so they look and behave alike. The section <main> landmark itself is rendered by the shell.
//
// Landmarks and keyboard: the header, the results and the detail panel are F6 regions (src/app/sections.ts
// F6_REGION_ATTRIBUTE); the results are a region named `resultsLabel`, the detail panel a complementary landmark named
// `detailLabel`. A search box inside `toolbar` should carry SECTION_SEARCH_ATTRIBUTE so Ctrl+F focuses it.
import { makeStyles, mergeClasses, Title3, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { F6_REGION_ATTRIBUTE } from '../app/sections';

/** Width of the detail panel: about a third of the section, at least 360 px and at most 560 px. */
export const DETAIL_PANEL_WIDTH = 'clamp(360px, 34%, 560px)';

const useStyles = makeStyles({
	root: {
		display: 'grid',
		gridTemplateRows: 'auto minmax(0, 1fr)',
		height: '100%',
		minHeight: 0,
		minWidth: 0,
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalL,
		rowGap: tokens.spacingVerticalS,
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
		minWidth: 0,
	},
	title: {
		margin: 0,
		flexShrink: 0,
	},
	toolbar: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
		flex: 1,
		minWidth: 0,
	},
	body: {
		display: 'grid',
		gridTemplateColumns: `minmax(0, 1fr) ${DETAIL_PANEL_WIDTH}`,
		minHeight: 0,
		minWidth: 0,
	},
	results: {
		minHeight: 0,
		minWidth: 0,
		overflow: 'auto',
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
		backgroundColor: tokens.colorNeutralBackground2,
	},
	detail: {
		minHeight: 0,
		minWidth: 0,
		overflow: 'auto',
		borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	focusable: {
		':focus-visible': {
			outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
			outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
		},
	},
});

export type SectionLayoutProps = {
	/** The section's visible heading (h1). */
	title: string;
	/** Search box, filters and commands of the section (one row; wraps when narrow). */
	toolbar?: ReactNode;
	/** The results (grid, list, gallery); the panel scrolls. */
	results: ReactNode;
	/** Accessible name of the results region (e.g. 'Model search results'). */
	resultsLabel: string;
	/** The detail of the selected item; null shows `emptyDetail`. */
	detail: ReactNode | null;
	/** Accessible name of the detail panel (e.g. 'Model details'). */
	detailLabel: string;
	/** What the detail panel says while nothing is selected. */
	emptyDetail?: ReactNode;
};

export function SectionLayout({ title, toolbar, results, resultsLabel, detail, detailLabel, emptyDetail }: SectionLayoutProps): JSX.Element {
	const styles = useStyles();
	const region = (id: string) => ({ [F6_REGION_ATTRIBUTE]: id, tabIndex: -1 });
	return (
		<div className={styles.root}>
			<header className={mergeClasses(styles.header, styles.focusable)} {...region('toolbar')}>
				<Title3 as="h1" className={styles.title}>
					{title}
				</Title3>
				{toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
			</header>
			<div className={styles.body}>
				<section aria-label={resultsLabel} className={mergeClasses(styles.results, styles.focusable)} {...region('results')}>
					{results}
				</section>
				<aside aria-label={detailLabel} className={mergeClasses(styles.detail, styles.focusable)} {...region('detail')}>
					{detail ?? emptyDetail ?? null}
				</aside>
			</div>
		</div>
	);
}
