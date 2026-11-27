// The layout of the full-page sections (Models, Images, Characters, Story): a header row (the section title, then its
// search, filters and commands), and below it the results (a grid that scrolls on its own) next to a detail panel of
// the selected item (scrolls on its own; shows `emptyDetail` while nothing is selected). Optional, docked in the same
// row: a navigation pane before the results (e.g. the Story section's list of stories) and a dock after the detail
// panel (a side panel plugged into the section, e.g. a chat panel). One layout for every section, so they look and
// behave alike. The section <main> landmark itself is rendered by the shell.
//
// Landmarks and keyboard: the header, the navigation pane, the results, the detail panel and the dock are F6 regions
// (src/app/sections.ts F6_REGION_ATTRIBUTE), in that order; the navigation pane is a navigation landmark named
// `navigationLabel`, the results a region named `resultsLabel`, the detail panel and the dock complementary landmarks
// named `detailLabel` / `dockLabel`. Without `detailLabel` there is no detail panel (the results take its room). A
// search box inside `toolbar` should carry SECTION_SEARCH_ATTRIBUTE so Ctrl+F focuses it.
//
// The dock can be collapsed (`dockCollapsed`, its owner's state): it becomes a narrow strip with an 'Expand <dock>'
// button and its vertical name, and the detail panel takes the room back; the panel stays mounted (hidden), so it keeps
// its state. Collapsing moves the focus from the panel to the Expand button, expanding moves it to the dock.
import { Button, makeStyles, mergeClasses, Title3, Tooltip, tokens, typographyStyles } from '@fluentui/react-components';
import { PanelRightExpandRegular } from '@fluentui/react-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import { F6_REGION_ATTRIBUTE } from '../app/sections';
import { EXPAND_DOCK_ATTRIBUTE, expandDockLabel } from './dockLabels';

/** Width of the detail panel: about a third of the section, at least 360 px and at most 560 px. */
export const DETAIL_PANEL_WIDTH = 'clamp(360px, 34%, 560px)';
/** Width of the detail panel next to a dock (both share the room the results leave). */
export const DOCKED_DETAIL_PANEL_WIDTH = 'clamp(320px, 28%, 480px)';
/** Width of the navigation pane before the results. */
export const NAVIGATION_PANE_WIDTH = 'clamp(200px, 18%, 280px)';
const DOCK_MIN_WIDTH = '300px';
const DOCK_SHARE_PERCENT = 26;
const DOCK_MAX_WIDTH = '420px';
/** Width of the dock after the detail panel. */
export const DOCK_PANEL_WIDTH = `clamp(${DOCK_MIN_WIDTH}, ${DOCK_SHARE_PERCENT}%, ${DOCK_MAX_WIDTH})`;
/** At least the width of an expanded dock, as a length of the window (its share of the whole window, a little more
 *  than of the section beside the rail): what keeps something at the window's end edge clear of the dock (toasts). */
export const DOCK_WINDOW_INSET = `clamp(${DOCK_MIN_WIDTH}, ${DOCK_SHARE_PERCENT}vw, ${DOCK_MAX_WIDTH})`;
/** Width of a collapsed dock (its strip). */
export const COLLAPSED_DOCK_WIDTH = '48px';

type DockState = 'none' | 'expanded' | 'collapsed';

/** The columns of the body: [navigation] results [detail] [dock]. */
function bodyColumns(navigation: boolean, detail: boolean, dock: DockState): string {
	return [
		navigation ? NAVIGATION_PANE_WIDTH : null,
		'minmax(0, 1fr)',
		detail ? (dock === 'expanded' ? DOCKED_DETAIL_PANEL_WIDTH : DETAIL_PANEL_WIDTH) : null,
		dock === 'none' ? null : dock === 'expanded' ? DOCK_PANEL_WIDTH : COLLAPSED_DOCK_WIDTH,
	]
		.filter(Boolean)
		.join(' ');
}

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
		minHeight: 0,
		minWidth: 0,
	},
	navigation: {
		minHeight: 0,
		minWidth: 0,
		overflow: 'auto',
		borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	dock: {
		minHeight: 0,
		minWidth: 0,
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column',
		borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	dockCollapsed: {
		backgroundColor: tokens.colorNeutralBackground3,
	},
	dockContent: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
	},
	hidden: {
		display: 'none',
	},
	strip: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalS,
		flex: 1,
		minHeight: 0,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		overflow: 'hidden',
	},
	stripLabel: {
		writingMode: 'vertical-rl',
		whiteSpace: 'nowrap',
		color: tokens.colorNeutralForeground2,
		...typographyStyles.caption1Strong,
	},
	results: {
		// Positioned: what the results scroll inside it (src/features/categories/scrollWithin.ts) is measured from it.
		position: 'relative',
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
	detail?: ReactNode | null;
	/** Accessible name of the detail panel (e.g. 'Model details'); without it the section has no detail panel. */
	detailLabel?: string;
	/** What the detail panel says while nothing is selected. */
	emptyDetail?: ReactNode;
	/** A pane before the results (e.g. the list of stories); it scrolls on its own. */
	navigation?: ReactNode;
	/** Accessible name of the navigation pane (required with `navigation`). */
	navigationLabel?: string;
	/** A side panel docked after the detail panel (e.g. a chat panel plugged into the section); it lays out its own
	 *  scrolling. null / absent: no dock. */
	dock?: ReactNode | null;
	/** Accessible name of the dock (required with `dock`). */
	dockLabel?: string;
	/** The dock is collapsed to its strip. */
	dockCollapsed?: boolean;
	/** The strip's Expand button (required with `dockCollapsed`). */
	onExpandDock?: () => void;
};

export function SectionLayout({
	title,
	toolbar,
	results,
	resultsLabel,
	detail = null,
	detailLabel,
	emptyDetail,
	navigation,
	navigationLabel,
	dock = null,
	dockLabel,
	dockCollapsed = false,
	onExpandDock,
}: SectionLayoutProps): JSX.Element {
	const styles = useStyles();
	const region = (id: string) => ({ [F6_REGION_ATTRIBUTE]: id, tabIndex: -1 });
	const hasNavigation = navigation !== undefined && navigation !== null;
	const hasDetail = detailLabel !== undefined;
	const hasDock = dock !== null;
	const dockState: DockState = !hasDock ? 'none' : dockCollapsed ? 'collapsed' : 'expanded';
	const dockRef = useRef<HTMLElement>(null);
	const expandRef = useRef<HTMLButtonElement>(null);
	const previousDockState = useRef(dockState);
	useEffect(() => {
		const previous = previousDockState.current;
		previousDockState.current = dockState;
		const focused = document.activeElement;
		const lost = focused === null || focused === document.body;
		if (previous === 'expanded' && dockState === 'collapsed' && (lost || dockRef.current?.contains(focused))) {
			expandRef.current?.focus();
		} else if (previous === 'collapsed' && dockState === 'expanded' && (lost || focused === expandRef.current)) {
			dockRef.current?.focus();
		}
	}, [dockState]);
	return (
		<div className={styles.root}>
			<header className={mergeClasses(styles.header, styles.focusable)} {...region('toolbar')}>
				<Title3 as="h1" className={styles.title}>
					{title}
				</Title3>
				{toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
			</header>
			<div className={styles.body} style={{ gridTemplateColumns: bodyColumns(hasNavigation, hasDetail, dockState) }}>
				{hasNavigation ? (
					<nav aria-label={navigationLabel} className={mergeClasses(styles.navigation, styles.focusable)} {...region('navigation')}>
						{navigation}
					</nav>
				) : null}
				<section aria-label={resultsLabel} className={mergeClasses(styles.results, styles.focusable)} {...region('results')}>
					{results}
				</section>
				{hasDetail ? (
					<aside aria-label={detailLabel} className={mergeClasses(styles.detail, styles.focusable)} {...region('detail')}>
						{detail ?? emptyDetail ?? null}
					</aside>
				) : null}
				{hasDock ? (
					<aside
						ref={dockRef}
						aria-label={dockLabel}
						data-collapsed={dockCollapsed ? 'true' : undefined}
						className={mergeClasses(styles.dock, dockCollapsed && styles.dockCollapsed, styles.focusable)}
						{...region('dock')}
					>
						{dockCollapsed ? (
							<div className={styles.strip}>
								<Tooltip content={expandDockLabel(dockLabel ?? '')} relationship="label" positioning="before">
									<Button ref={expandRef} appearance="subtle" icon={<PanelRightExpandRegular />} onClick={onExpandDock} {...{ [EXPAND_DOCK_ATTRIBUTE]: '' }} />
								</Tooltip>
								<span className={styles.stripLabel} aria-hidden>
									{dockLabel}
								</span>
							</div>
						) : null}
						<div className={dockCollapsed ? styles.hidden : styles.dockContent}>{dock}</div>
					</aside>
				) : null}
			</div>
		</div>
	);
}
