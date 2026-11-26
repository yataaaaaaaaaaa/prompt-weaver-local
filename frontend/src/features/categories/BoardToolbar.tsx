// The prompt board's top bar: a search landmark (the search box Ctrl+F focuses, SECTION_SEARCH_ATTRIBUTE, and the
// state filter), the board's command toolbar ('Board commands': Add category, Collapse all, Expand all, Sort by
// priority with its Ctrl+O hint) and the count of shown categories with 'Clear filter' while a filter is active. Thin
// view over the board and categories stores; it wraps onto several rows in a narrow board.
import {
	Button,
	Caption1,
	Dropdown,
	makeStyles,
	mergeClasses,
	Option,
	SearchBox,
	Toolbar,
	ToolbarButton,
	ToolbarDivider,
	tokens,
	Tooltip,
} from '@fluentui/react-components';
import { AddRegular, ArrowMaximizeVerticalRegular, ArrowMinimizeVerticalRegular, ArrowSortDownLinesRegular, FilterDismissRegular, FilterRegular } from '@fluentui/react-icons';
import type { KeyboardEvent } from 'react';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { BOARD_STATE_FILTER_LABELS, BOARD_STATE_FILTERS, isBoardStateFilter, type BoardStateFilter } from '../../domain/board';
import { useBoardStore, useCollapseSummary, useIsBoardFilterActive } from '../../stores/boardStore';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { ariaKeyShortcuts, withShortcut } from '../../ui/keyboard';
import { STATE_ICONS, useStateAccentClasses } from '../../ui/stateStyles';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flexShrink: 0,
		gap: tokens.spacingVerticalXS,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalXS,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		backgroundColor: tokens.colorNeutralBackground1,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	bar: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	search: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		flex: '1 1 320px',
		minWidth: 0,
	},
	// Side by side down to a 320 px board.
	searchBox: {
		flex: '1 1 140px',
		minWidth: 0,
		maxWidth: 'none',
	},
	stateFilter: {
		flex: '1 1 130px',
		minWidth: 0,
		maxWidth: '260px',
	},
	commands: {
		flexWrap: 'wrap',
		marginLeft: 'auto',
		padding: 0,
	},
	optionIcon: {
		fontSize: tokens.fontSizeBase400,
		flexShrink: 0,
	},
	option: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
	},
	status: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		minHeight: '24px',
	},
	count: {
		color: tokens.colorNeutralForeground2,
	},
});

/** 'N categories', or 'M of N categories' while a filter hides some. */
export function categoryCountText(shown: number, total: number, filtered: boolean): string {
	const noun = total === 1 ? 'category' : 'categories';
	return filtered ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

function StateFilterOption({ filter }: { filter: BoardStateFilter }): JSX.Element {
	const styles = useStyles();
	const accent = useStateAccentClasses();
	const label = BOARD_STATE_FILTER_LABELS[filter];
	const Icon = filter === 'any' ? FilterRegular : STATE_ICONS[filter];
	return (
		<Option value={filter} text={label}>
			<span className={styles.option}>
				<Icon aria-hidden className={mergeClasses(styles.optionIcon, filter === 'any' ? undefined : accent[filter])} />
				{label}
			</span>
		</Option>
	);
}

export type BoardToolbarProps = {
	/** How many cards the board shows (its filtered keys). */
	shown: number;
	/** Says something in the board's polite live region. */
	announce: (message: string) => void;
};

export function BoardToolbar({ shown, announce }: BoardToolbarProps): JSX.Element {
	const styles = useStyles();
	const query = useBoardStore((state) => state.filter.query);
	const stateFilter = useBoardStore((state) => state.filter.state);
	const setQuery = useBoardStore((state) => state.setQuery);
	const setStateFilter = useBoardStore((state) => state.setStateFilter);
	const clearFilter = useBoardStore((state) => state.clearFilter);
	const setAllCollapsed = useBoardStore((state) => state.setAllCollapsed);
	const filtered = useIsBoardFilterActive();
	const { anyCollapsed, anyExpanded } = useCollapseSummary();
	const total = useCategoriesStore((state) => state.categories.length);
	const addCategory = useCategoriesStore((state) => state.addCategory);
	const reorganize = useCategoriesStore((state) => state.reorganize);

	function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === 'Escape' && query !== '') {
			event.preventDefault();
			event.stopPropagation();
			setQuery('');
		}
	}

	return (
		<div className={styles.root}>
			<div className={styles.bar}>
				<div className={styles.search} role="search" aria-label="Find categories">
					<SearchBox
						className={styles.searchBox}
						size="medium"
						aria-label="Search categories"
						placeholder="Search prompts"
						value={query}
						onChange={(_event, data) => setQuery(data.value)}
						onKeyDown={handleSearchKeyDown}
						{...{ [SECTION_SEARCH_ATTRIBUTE]: '' }}
					/>
					<Dropdown
						className={styles.stateFilter}
						aria-label="Filter by state"
						value={BOARD_STATE_FILTER_LABELS[stateFilter]}
						selectedOptions={[stateFilter]}
						onOptionSelect={(_event, data) => {
							if (isBoardStateFilter(data.optionValue)) {
								setStateFilter(data.optionValue);
							}
						}}
					>
						{BOARD_STATE_FILTERS.map((filter) => (
							<StateFilterOption key={filter} filter={filter} />
						))}
					</Dropdown>
				</div>
				<Toolbar className={styles.commands} aria-label="Board commands" size="small">
					<ToolbarButton icon={<AddRegular />} onClick={() => addCategory()}>
						Add category
					</ToolbarButton>
					<ToolbarDivider />
					<Tooltip content="Collapse all" relationship="label">
						<ToolbarButton icon={<ArrowMinimizeVerticalRegular />} disabled={!anyExpanded} onClick={() => setAllCollapsed(true)} />
					</Tooltip>
					<Tooltip content="Expand all" relationship="label">
						<ToolbarButton icon={<ArrowMaximizeVerticalRegular />} disabled={!anyCollapsed} onClick={() => setAllCollapsed(false)} />
					</Tooltip>
					<Tooltip content={withShortcut('Sort by priority', 'sort-categories')} relationship="description">
						<ToolbarButton
							icon={<ArrowSortDownLinesRegular />}
							aria-label="Sort by priority"
							aria-keyshortcuts={ariaKeyShortcuts('sort-categories')}
							disabled={total === 0}
							onClick={() => {
								reorganize();
								announce('Categories sorted by priority');
							}}
						/>
					</Tooltip>
				</Toolbar>
			</div>
			<div className={styles.status}>
				<Caption1 className={styles.count} aria-live="polite">
					{categoryCountText(shown, total, filtered)}
				</Caption1>
				{filtered ? (
					<Button appearance="subtle" size="small" icon={<FilterDismissRegular />} onClick={clearFilter}>
						Clear filter
					</Button>
				) : null}
			</div>
		</div>
	);
}
