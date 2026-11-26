// Search controls of the catalog store for the Models section toolbar (SectionToolbar): the query text box (Ctrl+F
// focuses it), the filters (model types, base models with a hint on the ones that cannot run locally, sort and NSFW;
// their options come from the active provider info, a spinner while it loads), and the provider info error with
// Retry (shown above the results). Each control calls one store action; the store owns debouncing.
import {
	Button,
	Caption1,
	Dropdown,
	Field,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Option,
	SearchBox,
	Spinner,
	Switch,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { MODEL_KIND_LABELS, MODEL_SORT_LABELS } from '../../domain/modelCatalog';
import { selectActiveProvider, useModelCatalogStore } from '../../stores/modelCatalogStore';
import { useFilterStyles } from '../../ui/SectionToolbar';

const useStyles = makeStyles({
	option: {
		display: 'flex',
		flexDirection: 'column',
	},
});

export function CatalogSearchBox(): JSX.Element {
	const styles = useFilterStyles();
	const provider = useModelCatalogStore(selectActiveProvider);
	const query = useModelCatalogStore((state) => state.filters.query);
	const setQuery = useModelCatalogStore((state) => state.setQuery);
	return (
		<SearchBox
			className={styles.search}
			aria-label="Search models"
			placeholder={provider ? `Search ${provider.label} models` : 'Search models'}
			value={query}
			onChange={(_event, data) => setQuery(data.value)}
			{...{ [SECTION_SEARCH_ATTRIBUTE]: '' }}
		/>
	);
}

/** Type, base model and sort filters: their options come from the active provider (hidden until it is known). */
function ProviderFilters(): JSX.Element | null {
	const filterStyles = useFilterStyles();
	const styles = useStyles();
	const provider = useModelCatalogStore(selectActiveProvider);
	const kinds = useModelCatalogStore((state) => state.filters.kinds);
	const baseModels = useModelCatalogStore((state) => state.filters.base_models);
	const sort = useModelCatalogStore((state) => state.filters.sort);
	const setKinds = useModelCatalogStore((state) => state.setKinds);
	const setBaseModels = useModelCatalogStore((state) => state.setBaseModels);
	const setSort = useModelCatalogStore((state) => state.setSort);
	if (!provider) {
		return null;
	}

	return (
		<>
			<Field label="Type" orientation="horizontal" className={filterStyles.field}>
				<Dropdown
					multiselect
					className={filterStyles.dropdown}
					placeholder="All types"
					value={kinds.map((kind) => MODEL_KIND_LABELS[kind]).join(', ')}
					selectedOptions={kinds}
					onOptionSelect={(_event, data) => setKinds(provider.kinds.filter((kind) => data.selectedOptions.includes(kind)))}
				>
					{provider.kinds.map((kind) => (
						<Option key={kind} value={kind}>
							{MODEL_KIND_LABELS[kind]}
						</Option>
					))}
				</Dropdown>
			</Field>
			<Field label="Base model" orientation="horizontal" className={filterStyles.field}>
				<Dropdown
					multiselect
					className={filterStyles.dropdown}
					placeholder="All base models"
					value={baseModels.join(', ')}
					selectedOptions={baseModels}
					onOptionSelect={(_event, data) => setBaseModels(data.selectedOptions)}
				>
					{provider.base_models.map((option) => (
						<Option key={option.id} value={option.id} text={option.id}>
							<span className={styles.option}>
								{option.id}
								{option.architecture == null ? <Caption1 className={filterStyles.hint}>Not supported locally</Caption1> : null}
							</span>
						</Option>
					))}
				</Dropdown>
			</Field>
			<Field label="Sort by" orientation="horizontal" className={filterStyles.field}>
				<Dropdown
					className={filterStyles.dropdown}
					value={MODEL_SORT_LABELS[sort]}
					selectedOptions={[sort]}
					onOptionSelect={(_event, data) => {
						const picked = provider.sorts.find((item) => item === data.optionValue);
						if (picked && picked !== sort) {
							setSort(picked);
						}
					}}
				>
					{provider.sorts.map((item) => (
						<Option key={item} value={item}>
							{MODEL_SORT_LABELS[item]}
						</Option>
					))}
				</Dropdown>
			</Field>
		</>
	);
}

/** The filters of the online search: provider filters (a spinner while the providers load) and NSFW. */
export function CatalogFilters(): JSX.Element {
	const infoStatus = useModelCatalogStore((state) => state.infoStatus);
	const nsfw = useModelCatalogStore((state) => state.filters.nsfw);
	const setNsfw = useModelCatalogStore((state) => state.setNsfw);
	return (
		<>
			<ProviderFilters />
			<Switch label="Show NSFW" checked={nsfw} onChange={(_event, data) => setNsfw(data.checked)} />
			{infoStatus === 'idle' || infoStatus === 'loading' ? <Spinner size="tiny" label="Loading providers…" /> : null}
		</>
	);
}

/** The provider info could not be loaded: why, with Retry (nothing otherwise). */
export function ProviderInfoError(): JSX.Element | null {
	const infoStatus = useModelCatalogStore((state) => state.infoStatus);
	const infoError = useModelCatalogStore((state) => state.infoError);
	const loadInfo = useModelCatalogStore((state) => state.loadInfo);
	if (infoStatus !== 'failed') {
		return null;
	}
	return (
		<MessageBar intent="error" layout="multiline">
			<MessageBarBody>
				<MessageBarTitle>Could not load the model providers</MessageBarTitle>
				{infoError}
			</MessageBarBody>
			<MessageBarActions>
				<Button size="small" icon={<ArrowClockwiseRegular />} onClick={() => void loadInfo()}>
					Retry
				</Button>
			</MessageBarActions>
		</MessageBar>
	);
}
