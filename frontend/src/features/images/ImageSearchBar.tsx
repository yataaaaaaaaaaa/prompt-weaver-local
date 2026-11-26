// Search controls of the image library store for the Images section toolbar (SectionToolbar of
// src/features/models): the keyword box (Ctrl+F focuses it) and the filters: sort, period (disabled while a keyword is
// set: keyword searches go through the models' galleries, which ignore it; its hint says so), NSFW and "only locally
// usable models". Each control calls one store action; the store owns debouncing and searching.
import { Dropdown, Field, Option, SearchBox, Switch } from '@fluentui/react-components';
import type { ImagePeriod, ImageSort } from '../../api/types';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { IMAGE_PERIOD_LABELS, IMAGE_SORT_LABELS, isPeriodApplicable } from '../../domain/imageLibrary';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { useFilterStyles } from '../../ui/SectionToolbar';

const SORTS = Object.keys(IMAGE_SORT_LABELS) as ImageSort[];
const PERIODS = Object.keys(IMAGE_PERIOD_LABELS) as ImagePeriod[];

/** The hint under Period: always shown (the filter row keeps its height while a keyword is typed). */
export const PERIOD_HINTS = {
	applicable: 'Applies without a keyword.',
	ignored: 'Keyword searches ignore the period.',
} as const;

export function ImageSearchBox(): JSX.Element {
	const styles = useFilterStyles();
	const query = useImageLibraryStore((state) => state.filters.query);
	const setQuery = useImageLibraryStore((state) => state.setQuery);
	return (
		<SearchBox
			className={styles.search}
			aria-label="Search images"
			placeholder="Search images by keyword"
			value={query}
			onChange={(_event, data) => setQuery(data.value)}
			{...{ [SECTION_SEARCH_ATTRIBUTE]: '' }}
		/>
	);
}

function SortField(): JSX.Element {
	const styles = useFilterStyles();
	const sort = useImageLibraryStore((state) => state.filters.sort);
	const setSort = useImageLibraryStore((state) => state.setSort);
	return (
		<Field label="Sort by" orientation="horizontal" className={styles.field}>
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
	const styles = useFilterStyles();
	const period = useImageLibraryStore((state) => state.filters.period);
	const applicable = useImageLibraryStore((state) => isPeriodApplicable(state.filters));
	const setPeriod = useImageLibraryStore((state) => state.setPeriod);
	return (
		<Field label="Period" orientation="horizontal" className={styles.field} hint={applicable ? PERIOD_HINTS.applicable : PERIOD_HINTS.ignored}>
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

/** The filters of the image search. */
export function ImageSearchFilters(): JSX.Element {
	const nsfw = useImageLibraryStore((state) => state.filters.nsfw);
	const usableOnly = useImageLibraryStore((state) => state.filters.usable_only);
	const setNsfw = useImageLibraryStore((state) => state.setNsfw);
	const setUsableOnly = useImageLibraryStore((state) => state.setUsableOnly);
	return (
		<>
			<SortField />
			<PeriodField />
			<Switch label="Show NSFW" checked={nsfw} onChange={(_event, data) => setNsfw(data.checked)} />
			<Switch label="Only locally usable models" checked={usableOnly} onChange={(_event, data) => setUsableOnly(data.checked)} />
		</>
	);
}
