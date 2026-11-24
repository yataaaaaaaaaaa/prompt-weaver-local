// Search filters of the image library store: keyword, sort, period (disabled with a hint while a keyword is set:
// keyword searches go through the models' galleries, which ignore it), NSFW and "only locally usable models".
// Each control calls one store action; the store owns debouncing and searching.
import { Caption1, Dropdown, Field, makeStyles, Option, SearchBox, Switch, tokens } from '@fluentui/react-components';
import type { ImagePeriod, ImageSort } from '../../api/types';
import { IMAGE_PERIOD_LABELS, IMAGE_SORT_LABELS, isPeriodApplicable } from '../../domain/imageLibrary';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { PaneGrid } from '../../ui/PaneLayout';

const SORTS = Object.keys(IMAGE_SORT_LABELS) as ImageSort[];
const PERIODS = Object.keys(IMAGE_PERIOD_LABELS) as ImagePeriod[];

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	search: {
		width: '100%',
		maxWidth: 'none',
	},
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
	hint: {
		color: tokens.colorNeutralForeground3,
	},
});

function SortField(): JSX.Element {
	const styles = useStyles();
	const sort = useImageLibraryStore((state) => state.filters.sort);
	const setSort = useImageLibraryStore((state) => state.setSort);
	return (
		<Field label="Sort by">
			<Dropdown
				className={styles.dropdown}
				value={IMAGE_SORT_LABELS[sort]}
				selectedOptions={[sort]}
				onOptionSelect={(_event, data) => {
					const picked = SORTS.find((item) => item === data.optionValue);
					if (picked && picked !== sort) {
						setSort(picked);
					}
				}}
			>
				{SORTS.map((item) => (
					<Option key={item} value={item}>
						{IMAGE_SORT_LABELS[item]}
					</Option>
				))}
			</Dropdown>
		</Field>
	);
}

function PeriodField(): JSX.Element {
	const styles = useStyles();
	const period = useImageLibraryStore((state) => state.filters.period);
	const applicable = useImageLibraryStore((state) => isPeriodApplicable(state.filters));
	const setPeriod = useImageLibraryStore((state) => state.setPeriod);
	return (
		<Field label="Period" hint={applicable ? undefined : 'Keyword searches ignore the period.'}>
			<Dropdown
				className={styles.dropdown}
				disabled={!applicable}
				value={IMAGE_PERIOD_LABELS[period]}
				selectedOptions={[period]}
				onOptionSelect={(_event, data) => {
					const picked = PERIODS.find((item) => item === data.optionValue);
					if (picked && picked !== period) {
						setPeriod(picked);
					}
				}}
			>
				{PERIODS.map((item) => (
					<Option key={item} value={item}>
						{IMAGE_PERIOD_LABELS[item]}
					</Option>
				))}
			</Dropdown>
		</Field>
	);
}

export function ImageSearchBar(): JSX.Element {
	const styles = useStyles();
	const query = useImageLibraryStore((state) => state.filters.query);
	const nsfw = useImageLibraryStore((state) => state.filters.nsfw);
	const usableOnly = useImageLibraryStore((state) => state.filters.usable_only);
	const setQuery = useImageLibraryStore((state) => state.setQuery);
	const setNsfw = useImageLibraryStore((state) => state.setNsfw);
	const setUsableOnly = useImageLibraryStore((state) => state.setUsableOnly);

	return (
		<div className={styles.root}>
			<SearchBox
				className={styles.search}
				aria-label="Search images"
				placeholder="Search images by keyword"
				value={query}
				onChange={(_event, data) => setQuery(data.value)}
			/>
			<Caption1 className={styles.hint}>
				A keyword finds matching LoRAs and checkpoints and shows the images of their galleries. Without a keyword,
				all recent images are browsed by sort and period.
			</Caption1>
			<PaneGrid>
				<SortField />
				<PeriodField />
				<Switch label="Show NSFW" checked={nsfw} onChange={(_event, data) => setNsfw(data.checked)} />
				<Switch label="Only locally usable models" checked={usableOnly} onChange={(_event, data) => setUsableOnly(data.checked)} />
			</PaneGrid>
		</div>
	);
}
