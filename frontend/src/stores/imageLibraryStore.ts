// Image library store (online images): single truth holder of the image search (filters, results, paging), the
// image shown in the detail view, the resolution of each image's models, the running "Use these LoRAs" /
// checkpoint switches, and the favorites collection read from the backend (which owns it). Not persisted.
// Pure logic lives in src/domain/imageLibrary.ts. Cross-store coordination happens in the actions:
// - installs go through useModelCatalogStore.getState().install (the one install/download flow; progress stays
//   in the tasks store);
// - the LoRA selection is replaced with useLibraryStore.getState().setLoraSelection (LoraWeight items);
// - the checkpoint is selected with useLibraryStore.getState().selectModel, or installed (and selected) through
//   the catalog store;
// - tags become a sub-prompt through the categories store;
// - copies go through copyTextWithFeedback (src/stores/clipboardActions.ts).
import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../api/client';
import type { FavoriteImage, ImagePeriod, ImageSort, LoraWeight, RemoteImage } from '../api/types';
import { subPromptKeyOf, type CategoryKey } from '../domain/categories';
import {
	appliedLoraWeight,
	buildImageSearchQuery,
	DEFAULT_IMAGE_FILTERS,
	imageCheckpointRow,
	imageKey,
	imageLoraRows,
	imageTags,
	isInstallableRow,
	isPeriodApplicable,
	resolvedInstallKeys,
	UNRESOLVED_RESOURCE,
	type ImageFilters,
	type ImageResolution,
	type ImageResourceContext,
	type ImageResourceRow,
	type ResourceInstallState,
} from '../domain/imageLibrary';
import { weightedLorasText } from '../domain/loraSelection';
import { installOutcomeEntry, type InstallOptions } from '../domain/modelCatalog';
import { joinPromptTags, namedProblemsText } from '../domain/text';
import { findCategory, useCategoriesStore } from './categoriesStore';
import { copyTextWithFeedback } from './clipboardActions';
import { withFlag } from './flags';
import { useLibraryStore } from './libraryStore';
import { useModelCatalogStore } from './modelCatalogStore';
import { describeError, reportError, useNotificationsStore } from './notificationsStore';
import { createPagedSearch, type LoadStatus, type PagedSearchActions, type SearchStatus } from './pagedSearch';

/** Defined in src/domain/imageLibrary.ts (with the row builders that read them). */
export type { ImageResolution, ImageResolutionStatus } from '../domain/imageLibrary';

export type ImageLibraryState = {
	filters: ImageFilters;
	results: RemoteImage[];
	nextCursor: string | null;
	searchStatus: SearchStatus;
	searchError: string | null;
	/** The backend favorites collection, newest first (api.listFavoriteImages). */
	favorites: FavoriteImage[];
	favoritesStatus: LoadStatus;
	favoritesError: string | null;
	/** imageKey of the image shown in the detail view (null: none). Looked up in results, then favorites. */
	selectedImageKey: string | null;
	/** Resolution of each image's resources by imageKey (absent: never requested). */
	resolutions: Record<string, ImageResolution>;
	/** imageKeys whose "Use these LoRAs" is running. */
	applyingLoras: Record<string, true>;
	/** imageKeys whose checkpoint switch is running. */
	switchingCheckpoint: Record<string, true>;
};

export type ImageLibraryActions = {
	/** Idempotent first use of the pane: the first search (when none ran yet) and the favorites (once, again after
	 *  a failure). Never rejects. */
	activate: () => Promise<void>;
	/** Updates the query text and searches again after SEARCH_DEBOUNCE_MS of inactivity (src/stores/pagedSearch.ts). */
	setQuery: PagedSearchActions['setQuery'];
	/** The other filters search again immediately (no-op when unchanged). A period change does not search while a
	 *  keyword is set: a keyword search ignores the period (isPeriodApplicable). */
	setSort: (sort: ImageSort) => void;
	setPeriod: (period: ImagePeriod) => void;
	setNsfw: (nsfw: boolean) => void;
	setUsableOnly: (usableOnly: boolean) => void;
	/** Searches from the first page (aborting the request in flight; stale answers ignored). A failure clears the
	 *  results (searchError set, no notification). */
	search: PagedSearchActions['search'];
	/** Appends the next page (infinite scroll); no-op without nextCursor or while a search runs. A failure keeps
	 *  the results; images of earlier pages are not listed twice. */
	loadMore: PagedSearchActions['loadMore'];
	/** Shows the image (a result or a favorite; unknown keys are ignored) in the detail view and resolves its
	 *  resources when not resolved yet (or failed). */
	openImage: (imageKey: string) => void;
	closeImage: () => void;
	/** api.resolveImageResources for the image (an image without resources is ready at once); while one runs for
	 *  it, returns the running one (no second request); failures -> status 'failed' + error (no notification). */
	resolveResources: (imageKey: string) => Promise<void>;
	/** The image's LoRAs as library entries with their weights (no notification, no selection change): resolves the
	 *  image when needed (joining a running resolution), then per LoRA row (imageLoraRows): 'in_library' -> its entry;
	 *  resolved and installable (isInstallableRow) -> useModelCatalogStore.install(model, version, null,
	 *  { select: false, announce: false }) (concurrently; a running install is joined; downloads show their progress)
	 *  and the entry of its outcome; otherwise skipped with its reason. Usable LoRAs come in image order, deduped by
	 *  entry, with appliedLoraWeight. null for an unknown image. Shared by "Use these LoRAs" and the characters store
	 *  ("Create character" from an image). Rejects only when the resolution itself throws unexpectedly. */
	collectImageLoras: (imageKey: string) => Promise<ImageLoraCollection | null>;
	/** "Use these LoRAs": collectImageLoras, then replaces the selection with exactly the usable LoRAs via
	 *  useLibraryStore.setLoraSelection (unchanged when none is usable). Success notification listing
	 *  'name (weight)'; a warning listing the skipped LoRAs with their reasons; info when the image publishes no LoRA.
	 *  No-op while it runs for the image (applyingLoras). Never rejects. */
	applyImageLoras: (imageKey: string) => Promise<void>;
	/** Selects the image's checkpoint (imageCheckpointRow): its library entry (selectModel + success), else installs
	 *  it through the catalog store with the default options (which selects and announces it, and notifies its
	 *  failures). A warning with the reason when it cannot be resolved or installed. No-op while it runs for the
	 *  image (switchingCheckpoint). Never rejects. */
	switchToImageCheckpoint: (imageKey: string) => Promise<void>;
	/** Adds the image's tags (all, or `tags`) as one new sub-prompt (joinPromptTags) to the category `target`
	 *  (categoriesStore.addSubPromptWithText, which rejects duplicates), or to a new category when null (addCategory,
	 *  then its empty sub-prompt gets the text); success notification naming the category. A warning when there are
	 *  no tags. */
	addTagsToCategory: (imageKey: string, target: CategoryKey | null, tags?: readonly string[]) => void;
	/** Copies the published prompt (copyTextWithFeedback). */
	copyPrompt: (imageKey: string) => Promise<void>;
	/** Saves the image to the favorites (api.addFavoriteImage; the saved one goes first) or removes it
	 *  (api.removeFavoriteImage). Ignored while a toggle of the image runs. Failures reported; never rejects. */
	toggleFavorite: (imageKey: string) => Promise<void>;
	/** Reloads the favorites (api.listFavoriteImages). Never rejects. */
	loadFavorites: () => Promise<void>;
};

export type ImageLibraryStore = ImageLibraryState & ImageLibraryActions;

/** The LoRAs of an image as library entries (collectImageLoras). */
export type ImageLoraCollection = {
	/** LoRA rows of the image (imageLoraRows); 0 when it publishes none. */
	rowCount: number;
	/** Usable LoRAs: library entry id + appliedLoraWeight, in image order, deduped by entry. */
	items: LoraWeight[];
	/** Display name and weight of each usable LoRA (same order as items). */
	applied: { name: string; weight: number }[];
	/** LoRAs that cannot be used, with why. */
	skipped: { name: string; problem: string }[];
};

/** The promise of each running resolution by imageKey (resolveResources of a resolving image joins it); only
 *  joined while the store's resolution is 'loading' (the store state is the truth of what runs). */
const runningResolutions = new Map<string, Promise<void>>();
/** imageKeys whose favorite toggle runs (further clicks are ignored until the answer). */
const togglingFavorites = new Set<string>();

/** Install options of "Use these LoRAs": the selection is set afterwards with the weights, in one notification. */
const IMAGE_LORA_INSTALL: InstallOptions = { select: false, announce: false };

type RowUse = { entryId: string } | { problem: string };

/** The library entry of a row: its entry when in the library, else the entry the catalog install provides (a running
 *  install is joined); otherwise why it cannot be used. Never rejects. */
async function rowLibraryEntry(row: ImageResourceRow, options: InstallOptions): Promise<RowUse> {
	if (row.status === 'in_library' && row.libraryEntryId !== null) {
		return { entryId: row.libraryEntryId };
	}
	if (!isInstallableRow(row)) {
		return { problem: row.reason ?? UNRESOLVED_RESOURCE };
	}
	try {
		return installOutcomeEntry(await useModelCatalogStore.getState().install(row.model, row.version, null, options));
	} catch (error) {
		return { problem: describeError(error) };
	}
}

type ExclusiveField = 'applyingLoras' | 'switchingCheckpoint';

export const useImageLibraryStore = create<ImageLibraryStore>()((set, get) => {
	const pagedSearch = createPagedSearch<RemoteImage, ImageFilters>(set, get, {
		fetchPage: (filters, cursor, signal) => api.searchImages(buildImageSearchQuery(filters, cursor), signal),
		keyOf: imageKey,
		describeError,
	});

	/** Sets one filter (no-op when unchanged) and searches again from the first page when `searchNow`. */
	const setFilter = <K extends keyof ImageFilters>(name: K, value: ImageFilters[K], searchNow = true) => {
		if (get().filters[name] === value) {
			return;
		}
		set((state) => ({ filters: { ...state.filters, [name]: value } }));
		if (searchNow) {
			void get().search();
		}
	};

	const putResolution = (key: string, resolution: ImageResolution) => set((state) => ({ resolutions: { ...state.resolutions, [key]: resolution } }));

	const runResolution = async (key: string, image: RemoteImage): Promise<void> => {
		putResolution(key, { status: 'loading', items: [], error: null });
		try {
			const items = image.resources.length ? await api.resolveImageResources({ provider: image.provider, resources: image.resources }) : [];
			putResolution(key, { status: 'ready', items, error: null });
		} catch (error) {
			putResolution(key, { status: 'failed', items: [], error: describeError(error) });
		}
	};

	/** Resolves the image unless its resolution is ready (joins a running one, retries a failed one). */
	const ensureResolution = async (key: string): Promise<void> => {
		if (get().resolutions[key]?.status !== 'ready') {
			await get().resolveResources(key);
		}
	};

	/** What the image's rows are computed from, read now from the owning stores. */
	const resourceContext = (key: string): ImageResourceContext => {
		const { models, loras } = useLibraryStore.getState();
		return { resolution: get().resolutions[key], library: { models, loras }, installs: useModelCatalogStore.getState().installs };
	};

	const setRunning = (field: ExclusiveField, key: string, on: boolean) =>
		set((state) => (field === 'applyingLoras' ? { applyingLoras: withFlag(state.applyingLoras, key, on) } : { switchingCheckpoint: withFlag(state.switchingCheckpoint, key, on) }));

	/** Runs `action` on the image, once at a time per image (flag `field` set meanwhile); failures reported. Never
	 *  rejects. */
	const exclusively = async (field: ExclusiveField, key: string, failureTitle: string, action: (image: RemoteImage) => Promise<void>) => {
		const image = selectImage(key)(get());
		if (!image || get()[field][key]) {
			return;
		}
		setRunning(field, key, true);
		try {
			await action(image);
		} catch (error) {
			reportError(error, failureTitle);
		} finally {
			setRunning(field, key, false);
		}
	};

	return {
		filters: DEFAULT_IMAGE_FILTERS,
		results: [],
		nextCursor: null,
		searchStatus: 'idle',
		searchError: null,
		favorites: [],
		favoritesStatus: 'idle',
		favoritesError: null,
		selectedImageKey: null,
		resolutions: {},
		applyingLoras: {},
		switchingCheckpoint: {},

		activate: async () => {
			const { searchStatus, favoritesStatus } = get();
			await Promise.all([
				searchStatus === 'idle' ? get().search() : undefined,
				favoritesStatus === 'idle' || favoritesStatus === 'failed' ? get().loadFavorites() : undefined,
			]);
		},

		...pagedSearch,
		setSort: (sort) => setFilter('sort', sort),
		// A keyword search ignores the period (isPeriodApplicable): its results would not change.
		setPeriod: (period) => setFilter('period', period, isPeriodApplicable(get().filters)),
		setNsfw: (nsfw) => setFilter('nsfw', nsfw),
		setUsableOnly: (usableOnly) => setFilter('usable_only', usableOnly),

		openImage: (key) => {
			if (!selectImage(key)(get())) {
				return;
			}
			if (get().selectedImageKey !== key) {
				set({ selectedImageKey: key });
			}
			const status = get().resolutions[key]?.status;
			if (status === undefined || status === 'failed') {
				void get().resolveResources(key);
			}
		},

		closeImage: () => {
			if (get().selectedImageKey !== null) {
				set({ selectedImageKey: null });
			}
		},

		resolveResources: (key) => {
			if (get().resolutions[key]?.status === 'loading') {
				return runningResolutions.get(key) ?? Promise.resolve();
			}
			const image = selectImage(key)(get());
			if (!image) {
				return Promise.resolve();
			}
			const running = runResolution(key, image).finally(() => {
				if (runningResolutions.get(key) === running) {
					runningResolutions.delete(key);
				}
			});
			runningResolutions.set(key, running);
			return running;
		},

		collectImageLoras: async (key) => {
			const image = selectImage(key)(get());
			if (!image) {
				return null;
			}
			await ensureResolution(key);
			const rows = imageLoraRows(image, resourceContext(key));
			const uses = await Promise.all(rows.map((row) => rowLibraryEntry(row, IMAGE_LORA_INSTALL)));
			const collection: ImageLoraCollection = { rowCount: rows.length, items: [], applied: [], skipped: [] };
			rows.forEach((row, position) => {
				const use = uses[position];
				if ('problem' in use) {
					collection.skipped.push({ name: row.name, problem: use.problem });
				} else if (!collection.items.some((item) => item.id === use.entryId)) {
					const weight = appliedLoraWeight(row.resource);
					collection.items.push({ id: use.entryId, weight });
					collection.applied.push({ name: row.name, weight });
				}
			});
			return collection;
		},

		applyImageLoras: (key) =>
			exclusively('applyingLoras', key, 'Could not use the LoRAs', async () => {
				const collection = await get().collectImageLoras(key);
				const { notify } = useNotificationsStore.getState();
				if (!collection) {
					return;
				}
				if (collection.rowCount === 0) {
					notify('info', 'This image publishes no LoRA.');
					return;
				}
				const { items, applied, skipped } = collection;
				if (items.length) {
					useLibraryStore.getState().setLoraSelection(items);
					notify('success', `LoRAs selected for generation: ${weightedLorasText(applied)}.`);
				}
				if (skipped.length) {
					notify('warning', namedProblemsText(skipped), {
						title: items.length ? 'Some LoRAs of this image were skipped' : 'No LoRA of this image can be used: the selection is unchanged',
					});
				}
			}),

		switchToImageCheckpoint: (key) =>
			exclusively('switchingCheckpoint', key, 'Could not switch the checkpoint', async (image) => {
				await ensureResolution(key);
				const row = imageCheckpointRow(image, resourceContext(key));
				const { notify } = useNotificationsStore.getState();
				if (!row) {
					notify('info', 'This image publishes no checkpoint.');
				} else if (row.status === 'in_library' && row.libraryEntryId !== null) {
					useLibraryStore.getState().selectModel(row.libraryEntryId);
					notify('success', `${row.name} is selected for generation.`);
				} else if (isInstallableRow(row)) {
					// Installs, selects and announces it; its failures are notified by the catalog store.
					await useModelCatalogStore.getState().install(row.model, row.version);
				} else {
					notify('warning', row.reason ?? UNRESOLVED_RESOURCE, { title: `${row.name} cannot be used` });
				}
			}),

		addTagsToCategory: (key, target, tags) => {
			const image = selectImage(key)(get());
			if (!image) {
				return;
			}
			const { notify } = useNotificationsStore.getState();
			const text = joinPromptTags(tags ?? imageTags(image));
			if (!text) {
				notify('warning', 'This image has no tags to add.');
				return;
			}
			const categories = useCategoriesStore.getState();
			let categoryKey: CategoryKey;
			if (target === null) {
				categoryKey = categories.addCategory();
				if (!useCategoriesStore.getState().setSubPromptText(categoryKey, subPromptKeyOf(''), text)) {
					return;
				}
			} else {
				if (!categories.addSubPromptWithText(target, text)) {
					return;
				}
				categoryKey = target;
			}
			const name = findCategory(useCategoriesStore.getState().categories, categoryKey)?.text ?? categoryKey;
			notify('success', `Tags added to the category '${name}'.`);
		},

		copyPrompt: (key) => copyTextWithFeedback(selectImage(key)(get())?.params?.prompt, 'Prompt'),

		toggleFavorite: async (key) => {
			const image = selectImage(key)(get());
			if (!image || togglingFavorites.has(key)) {
				return;
			}
			togglingFavorites.add(key);
			try {
				if (selectIsFavorite(key)(get())) {
					await api.removeFavoriteImage(image.provider, image.id);
					set((state) => ({ favorites: state.favorites.filter((favorite) => imageKey(favorite.image) !== key) }));
				} else {
					const favorite = await api.addFavoriteImage(image);
					set((state) => ({ favorites: [favorite, ...state.favorites.filter((item) => imageKey(item.image) !== key)] }));
				}
			} catch (error) {
				reportError(error, 'Could not update the favorites');
			} finally {
				togglingFavorites.delete(key);
			}
		},

		loadFavorites: async () => {
			set({ favoritesStatus: 'loading', favoritesError: null });
			try {
				const favorites = await api.listFavoriteImages();
				set({ favorites, favoritesStatus: 'ready' });
			} catch (error) {
				set({ favoritesStatus: 'failed', favoritesError: describeError(error) });
			}
		},
	};
});

// ---------------------------------------------------------------------------
// Selectors / hooks (views read through these; nothing derived is stored)
// ---------------------------------------------------------------------------

/** The image with this key among the results, then the favorites (null when unknown). */
export const selectImage =
	(key: string | null) =>
	(state: ImageLibraryState): RemoteImage | null => {
		if (key === null) {
			return null;
		}
		return (
			state.results.find((image) => imageKey(image) === key) ??
			state.favorites.find((favorite) => imageKey(favorite.image) === key)?.image ??
			null
		);
	};

/** The image shown in the detail view. */
export const selectSelectedImage = (state: ImageLibraryState): RemoteImage | null => selectImage(state.selectedImageKey)(state);

export const selectIsFavorite =
	(key: string) =>
	(state: ImageLibraryState): boolean =>
		state.favorites.some((favorite) => imageKey(favorite.image) === key);

const EMPTY_TAGS: string[] = [];
const EMPTY_ROWS: ImageResourceRow[] = [];

/** The image with this key (selectImage), subscribed with a selector stable per key. */
function useImage(key: string | null): RemoteImage | null {
	return useImageLibraryStore(useMemo(() => selectImage(key), [key]));
}

/** Tags of the image (imageTags of src/domain/imageLibrary.ts); stable while the image is unchanged. [] for null. */
export function useImageTags(key: string | null): string[] {
	const image = useImage(key);
	return useMemo(() => (image ? imageTags(image) : EMPTY_TAGS), [image]);
}

/** What the image's rows are computed from (ImageResourceContext), with fine-grained subscriptions: its resolution,
 *  the library entries and only the catalog installs of its resolved versions. Stable while they are unchanged. */
function useImageResourceContext(key: string | null): ImageResourceContext {
	const resolution = useImageLibraryStore((state) => (key === null ? undefined : state.resolutions[key]));
	const models = useLibraryStore((state) => state.models);
	const loras = useLibraryStore((state) => state.loras);
	const installKeys = useMemo(() => resolvedInstallKeys(resolution), [resolution]);
	const installList = useModelCatalogStore(useShallow((state) => installKeys.map((installKey) => state.installs[installKey])));
	return useMemo(() => {
		const installs: Record<string, ResourceInstallState | undefined> = {};
		installKeys.forEach((installKey, position) => {
			installs[installKey] = installList[position];
		});
		return { resolution, library: { models, loras }, installs };
	}, [resolution, models, loras, installKeys, installList]);
}

/** LoRA rows of the image's detail view (one per LoRA resource, in order), combining its resolution, the library
 *  store entries and the catalog store installs (views read the download progress of a row's install through
 *  installs[row.installKey].taskId). Memoized. [] for null. */
export function useImageLoraRows(key: string | null): ImageResourceRow[] {
	const image = useImage(key);
	const context = useImageResourceContext(key);
	return useMemo(() => (image ? imageLoraRows(image, context) : EMPTY_ROWS), [image, context]);
}

/** The checkpoint row of the image (its first checkpoint resource; null when it publishes none, or for null).
 *  Memoized. */
export function useImageCheckpointRow(key: string | null): ImageResourceRow | null {
	const image = useImage(key);
	const context = useImageResourceContext(key);
	return useMemo(() => (image ? imageCheckpointRow(image, context) : null), [image, context]);
}
