// Search filters of the catalog store: query text, model types, base models (with a hint on the ones that
// cannot run locally), sort and NSFW. Options come from the active provider info (spinner while it loads,
// error with Retry when it failed). Each control calls one store action; the store owns debouncing.
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
	tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { MODEL_KIND_LABELS, MODEL_SORT_LABELS } from '../../domain/modelCatalog';
import { selectActiveProvider, useModelCatalogStore } from '../../stores/modelCatalogStore';
import { PaneGrid } from '../../ui/PaneLayout';

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
	option: {
		display: 'flex',
		flexDirection: 'column',
	},
	hint: {
		color: tokens.colorNeutralForeground3,
	},
	switch: {
		alignSelf: 'end',
	},
});

/** Type, base model and sort filters: their options come from the active provider (hidden until it is known). */
function ProviderFilters(): JSX.Element | null {
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
			<Field label="Type">
				<Dropdown
					multiselect
					className={styles.dropdown}
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
			<Field label="Base model">
				<Dropdown
					multiselect
					className={styles.dropdown}
					placeholder="All base models"
					value={baseModels.join(', ')}
					selectedOptions={baseModels}
					onOptionSelect={(_event, data) => setBaseModels(data.selectedOptions)}
				>
					{provider.base_models.map((option) => (
						<Option key={option.id} value={option.id} text={option.id}>
							<span className={styles.option}>
								{option.id}
								{option.architecture == null ? <Caption1 className={styles.hint}>Not supported locally</Caption1> : null}
							</span>
						</Option>
					))}
				</Dropdown>
			</Field>
			<Field label="Sort by">
				<Dropdown
					className={styles.dropdown}
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

function ProviderInfoStatus(): JSX.Element | null {
	const infoStatus = useModelCatalogStore((state) => state.infoStatus);
	const infoError = useModelCatalogStore((state) => state.infoError);
	const loadInfo = useModelCatalogStore((state) => state.loadInfo);
	if (infoStatus === 'failed') {
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
	if (infoStatus === 'idle' || infoStatus === 'loading') {
		return <Spinner size="tiny" label="Loading providers…" />;
	}
	return null;
}

export function CatalogSearchBar(): JSX.Element {
	const styles = useStyles();
	const provider = useModelCatalogStore(selectActiveProvider);
	const query = useModelCatalogStore((state) => state.filters.query);
	const nsfw = useModelCatalogStore((state) => state.filters.nsfw);
	const setQuery = useModelCatalogStore((state) => state.setQuery);
	const setNsfw = useModelCatalogStore((state) => state.setNsfw);

	return (
		<div className={styles.root}>
			<SearchBox
				className={styles.search}
				aria-label="Search models"
				placeholder={provider ? `Search ${provider.label} models` : 'Search models'}
				value={query}
				onChange={(_event, data) => setQuery(data.value)}
			/>
			<PaneGrid>
				<ProviderFilters />
				<Switch className={styles.switch} label="Show NSFW" checked={nsfw} onChange={(_event, data) => setNsfw(data.checked)} />
			</PaneGrid>
			<ProviderInfoStatus />
		</div>
	);
}
