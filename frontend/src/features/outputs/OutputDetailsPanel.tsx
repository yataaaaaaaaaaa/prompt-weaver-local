// The output details panel of the viewer, below the filmstrip: a fixed share of the viewer's height, shown while the
// layout store says so (details.open, the toolbar's 'Output details' toggle), with two tabs (details.tab): Details (how
// the output was made) and Used sub-prompts (what each category contributed, and the forbidden associations edited
// from there). The tab body scrolls on its own. Thin view over the layout store.
import { makeStyles, Tab, TabList, tokens, useId } from '@fluentui/react-components';
import { DETAILS_TABS, type DetailsTab } from '../../domain/layout';
import { useLayoutStore } from '../../stores/layoutStore';
import { PaneContent } from '../../ui/PaneLayout';
import { UsedSelectionsPane } from '../forbidden/UsedSelectionsPane';
import { OutputDetailsList } from './OutputDetailsList';
import { DETAILS_TAB_LABELS } from './viewerLabels';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		// A fixed share of the viewer: the picture keeps the rest.
		flex: '0 0 38%',
		minHeight: '160px',
		minWidth: 0,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	tabs: {
		flexShrink: 0,
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	body: {
		flex: 1,
		minHeight: 0,
		overflowY: 'auto',
		overflowX: 'hidden',
		outlineStyle: 'none',
		':focus-visible': {
			outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
			outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
		},
	},
});

export function OutputDetailsPanel(): JSX.Element | null {
	const styles = useStyles();
	const open = useLayoutStore((state) => state.details.open);
	const tab = useLayoutStore((state) => state.details.tab);
	const showDetailsTab = useLayoutStore((state) => state.showDetailsTab);
	const idPrefix = useId('output-details-');
	if (!open) {
		return null;
	}
	const tabId = (value: DetailsTab) => `${idPrefix}-${value}-tab`;
	const panelId = `${idPrefix}-panel`;
	return (
		<div className={styles.root}>
			<TabList
				className={styles.tabs}
				size="small"
				selectedValue={tab}
				onTabSelect={(_event, data) => {
					const next = DETAILS_TABS.find((value) => value === data.value);
					if (next) {
						showDetailsTab(next);
					}
				}}
			>
				{DETAILS_TABS.map((value) => (
					<Tab key={value} value={value} id={tabId(value)} aria-controls={panelId}>
						{DETAILS_TAB_LABELS[value]}
					</Tab>
				))}
			</TabList>
			<div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} className={styles.body} tabIndex={0}>
				{tab === 'details' ? (
					<PaneContent>
						<OutputDetailsList />
					</PaneContent>
				) : (
					<UsedSelectionsPane />
				)}
			</div>
		</div>
	);
}
