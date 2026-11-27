// Story store: single truth holder, in the frontend, of the stories (read from and saved to the backend, which owns
// them: /api/stories, backend/app/services/stories.py) and of the Story section's state: the selected story and scene,
// the reader (read mode and its page), a running "generate scenes" run (current scene, queue, progress) and the
// export in progress, and the section's dock (collapsed or not). Only the dock's collapse is persisted ('story-store',
// version 0): the backend persists the stories, the selection lasts for the session. Pure logic
// lives in src/domain/stories.ts (scene prompt overrides as pinned categories, missing scenes, the prefill from an
// output, lock edits, scene moves, reader pages, the export file name).
//
// THE action API of story mode: the Story section's views and any tool layer (e.g. a co-writer chat panel) call these
// actions, never the API directly, so every rule lives once:
// - stories: load, createStory, updateStory (title, characters), deleteStory, selectStory;
// - scenes: addScene, updateScene (title, text, extra / negative tags, locks, characters, seed), lockSubPrompt,
//   unlockCategory, duplicateScene, deleteScene, moveScene / moveSceneNextTo / setSceneOrder, selectScene;
// - illustrations: generateScene, generateScenes, generateMissing, cancelGeneration, chooseVariant, addVariant,
//   removeVariant, addSceneFromOutput (Create's "Add to story");
// - reading and export: openReader, closeReader, setReaderPage, exportStory;
// - the dock (src/features/story/storyDock.ts): setDockCollapsed.
// Every action resolves (never rejects): failures are reported through the notifications store and the action
// answers null / false / [].
//
// Cross-store coordination happens in the actions: scene generations go through useGenerationStore.generateScene (the
// one generate path; its request is built by buildGenerationRequest with the scene's input), the characters come from
// the characters store, the user categories from the categories store, the outputs from the outputs store (which ones
// exist; the current output for "Add to story"), hand-offs show the Story section (useNavigationStore) or offer 'Go to
// Story', and the export uses the desktop save dialog (src/services/desktop.ts) or a browser download
// (src/services/download.ts).
//
// Writes of one story are serialized (each request waits for the previous one of that story), so every answer holds
// the changes sent before it. A scene change shows at once (withScenePatch) and stays shown on top of earlier answers
// until its own answer arrives; a failed one is undone by reading the story again.
// Rule: never read another store at module top level or in the initial state (stores import each other).
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ApiError, api } from '../api/client';
import type { OutputRecord, Scene, SceneCreateRequest, ScenePatch, Story, StoryPatch } from '../api/types';
import type { BoardMove, BoardMoveResult, Placement } from '../domain/board';
import { boardPositionOf } from '../domain/board';
import { isRecord } from '../domain/guards';
import {
	clampReaderPage,
	missingSceneIds,
	newStoryTitle,
	sceneFromOutput,
	sceneGenerationInput,
	sceneOrderAfterDrop,
	sceneOrderAfterMove,
	sceneStatus,
	storyCharacterIdsFromOutput,
	storyExportFileName,
	withSceneLock,
	withScenePatch,
	withStory,
	withoutSceneLock,
	type SceneStatus,
	type StoryGenerationProgress,
} from '../domain/stories';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { desktop } from '../services/desktop';
import { download } from '../services/download';
import { useCategoriesStore } from './categoriesStore';
import { selectActiveCharacter, useCharactersStore } from './charactersStore';
import { withFlag } from './flags';
import { GENERATION_BUSY_MESSAGE, isAbortError, useGenerationStore } from './generationStore';
import { selectSelectedModel, useLibraryStore } from './libraryStore';
import { goToSectionAction, useNavigationStore } from './navigationStore';
import { describeError, reportError, useNotificationsStore, type NotificationsActions } from './notificationsStore';
import { selectOutputIdSet, useOutputsStore } from './outputsStore';
import type { LoadStatus } from './pagedSearch';

/** A running "generate scenes" run (generateScenes / generateMissing): one scene at a time, in order. */
export type StoryGeneration = StoryGenerationProgress & {
	storyId: string;
	/** Scenes of this run generated so far. */
	completed: number;
	/** Scenes in this run. */
	total: number;
};

export type StoryState = {
	/** Every story, in the backend's creation order (api.listStories). */
	stories: Story[];
	loadStatus: LoadStatus;
	loadError: string | null;
	/** The story the section shows (null: none; the first story is selected once loaded). */
	selectedStoryId: string | null;
	/** The scene of the selected story shown in the detail panel (null: none). */
	selectedSceneId: string | null;
	/** Read mode of the selected story: the page (0-based scene index); null: the storyboard is shown. */
	reader: { page: number } | null;
	generation: StoryGeneration | null;
	/** Story ids with an export in progress. */
	exportingIds: Record<string, true>;
	/** The section's dock (a plugged-in panel such as the co-writer) is a narrow strip, so the scenes get its room. */
	dockCollapsed: boolean;
};

export type StoryActions = {
	/** api.listStories -> stories (loadStatus 'loading' -> 'ready' | 'failed' + loadError, no notification). Keeps the
	 *  selection when it still exists; selects the first story otherwise. Called at boot by the session store and by
	 *  the section's Retry. */
	load: () => Promise<void>;
	/** Creates a story ('New story', 'New story 2'... unless titled) and selects it. */
	createStory: (fields?: { title?: string; characterIds?: string[] }) => Promise<Story | null>;
	/** Changes the title and/or the characters of a story. */
	updateStory: (storyId: string, patch: StoryPatch) => Promise<Story | null>;
	/** Deletes a story (its outputs are kept); the next story is selected when it was the selected one. */
	deleteStory: (storyId: string) => Promise<boolean>;
	/** Shows a story (null: none; an unknown id is ignored): its scene selection is cleared and the reader closed. */
	selectStory: (storyId: string | null) => void;
	/** Shows a scene of the selected story in the detail panel (null: none; an unknown id is ignored). */
	selectScene: (sceneId: string | null) => void;

	/** Adds a scene (SceneCreateRequest: fields, position, an output illustrating it), selects the story and the scene;
	 *  answers the new scene. */
	addScene: (storyId: string, request?: SceneCreateRequest) => Promise<Scene | null>;
	/** Changes the fields of `patch` (title, text, extra_tags, negative_tags, locks, character_ids: null = the story's
	 *  characters, seed: null = random). Shown at once; answers the saved story. */
	updateScene: (storyId: string, sceneId: string, patch: ScenePatch) => Promise<Story | null>;
	/** Chooses `promptText` for the scene's category `categoryName` (withSceneLock: replaces that category's lock). */
	lockSubPrompt: (storyId: string, sceneId: string, categoryName: string, promptText: string) => Promise<Story | null>;
	/** Removes the scene's lock of `categoryName` (the prompt engine picks that category's sub-prompt again). */
	unlockCategory: (storyId: string, sceneId: string, categoryName: string) => Promise<Story | null>;
	/** Inserts a copy after the scene and selects it; answers the copy. */
	duplicateScene: (storyId: string, sceneId: string) => Promise<Scene | null>;
	/** Deletes the scene (its outputs are kept); its neighbour is selected when it was the selected one. */
	deleteScene: (storyId: string, sceneId: string) => Promise<boolean>;
	/** Keyboard reorder (previous / next / first / last, like the prompt board's cards): answers the scene's position
	 *  and whether it moved (null: unknown scene, or the request failed). */
	moveScene: (storyId: string, sceneId: string, move: BoardMove) => Promise<BoardMoveResult | null>;
	/** Drop reorder: the scene lands right before / after `targetId`. */
	moveSceneNextTo: (storyId: string, sceneId: string, targetId: string, placement: Placement) => Promise<BoardMoveResult | null>;
	/** Puts the scenes in this order (every scene id of the story, once). */
	setSceneOrder: (storyId: string, sceneIds: string[]) => Promise<Story | null>;

	/** Illustrates one scene (generateScenes with that scene); answers its new output. */
	generateScene: (storyId: string, sceneId: string) => Promise<OutputRecord | null>;
	/** Illustrates scenes one after the other, in the given order, through useGenerationStore.generateScene (the scene's
	 *  input: sceneGenerationInput); after each one the story is read again (the backend made the output the scene's
	 *  chosen variant). Refused (a warning) while a run or another generation is going on. Stops at the first failure
	 *  (reported) or at cancelGeneration. A run of several scenes is announced when it completes. Answers the outputs
	 *  made. */
	generateScenes: (storyId: string, sceneIds: string[]) => Promise<OutputRecord[]>;
	/** generateScenes of the scenes without an illustration (missingSceneIds), in story order. */
	generateMissing: (storyId: string) => Promise<OutputRecord[]>;
	/** Stops the run: the scene being generated is cancelled (useGenerationStore.cancel), the queue dropped. */
	cancelGeneration: () => Promise<void>;
	/** Makes one of the scene's variants its illustration. */
	chooseVariant: (storyId: string, sceneId: string, outputId: string) => Promise<Story | null>;
	/** Adds an existing output to the scene's variants (it becomes the illustration). */
	addVariant: (storyId: string, sceneId: string, outputId: string) => Promise<Story | null>;
	/** Removes a variant from the scene (the output is kept). */
	removeVariant: (storyId: string, sceneId: string, outputId: string) => Promise<Story | null>;
	/** "Add to story" (Create): a new scene of `storyId` (null: a new story with the output's character) prefilled from
	 *  the current output (sceneFromOutput: its image, its selections as locks, its seed); selects it and announces it
	 *  with 'Go to Story'. A warning when no output is shown. Answers the new scene. */
	addSceneFromOutput: (storyId: string | null) => Promise<Scene | null>;

	/** Read mode of the selected story, at `page` (default: the selected scene, else the first). */
	openReader: (page?: number) => void;
	closeReader: () => void;
	/** Shows a page of the reader (clampReaderPage); the page's scene becomes the selected scene. */
	setReaderPage: (page: number) => void;
	/** The story as one HTML file (api.exportStory): saved where the desktop save dialog says, else downloaded by the
	 *  browser. Announced; answers whether it was saved. */
	exportStory: (storyId: string) => Promise<boolean>;
	/** Collapses the dock to a strip (with its Expand button) or expands it. */
	setDockCollapsed: (collapsed: boolean) => void;
};

export type StoryStore = StoryState & StoryActions;

/** The persisted part of the story store. */
export type PersistedStoryState = Pick<StoryState, 'dockCollapsed'>;

/** Notification titles of the failures (tests and views share them). */
export const STORY_FAILURES = {
	create: 'Could not create the story',
	update: 'Could not save the story',
	delete: 'Could not delete the story',
	addScene: 'Could not add the scene',
	updateScene: 'Could not save the scene',
	duplicate: 'Could not duplicate the scene',
	deleteScene: 'Could not delete the scene',
	order: 'Could not reorder the scenes',
	variant: 'Could not change the illustration',
	generate: 'Could not illustrate the scene',
	export: 'Could not export the story',
} as const;

/** File dialog filters of the HTML export. */
const EXPORT_FILE_FILTERS = [{ name: 'Web page', extensions: ['html'] }];

type PendingChange = { token: number; apply: (story: Story) => Story };

export const useStoryStore = create<StoryStore>()(
	persist(
		(set, get) => {
			/** Identifies the latest load (an older answer is ignored). */
			let loadToken = 0;
			/** Incremented to stop the running generation run. */
			let generationRun = 0;
			/** The write chain of each story (requests of one story run one after the other). */
			const queues = new Map<string, Promise<unknown>>();
			/** Scene changes shown before their answer, per story, in order. */
			const pendingChanges = new Map<string, PendingChange[]>();
			let changeToken = 0;

			const notify: NotificationsActions['notify'] = (...args) => useNotificationsStore.getState().notify(...args);

			const findStory = (storyId: string): Story | null => get().stories.find((story) => story.id === storyId) ?? null;

			/** `task` after every earlier write of the story. */
			const enqueue = <T>(storyId: string, task: () => Promise<T>): Promise<T> => {
				const previous = queues.get(storyId) ?? Promise.resolve();
				const next = previous.then(task, task);
				queues.set(storyId, next);
				const forget = () => {
					if (queues.get(storyId) === next) {
						queues.delete(storyId);
					}
				};
				next.then(forget, forget);
				return next;
			};

			/** A story answered by the backend, with the scene changes still waiting for their answer shown on top. */
			const applyServerStory = (story: Story): Story => {
				const shown = (pendingChanges.get(story.id) ?? []).reduce((current, change) => change.apply(current), story);
				set((state) => ({ stories: withStory(state.stories, shown) }));
				return shown;
			};

			const removeStoryLocally = (storyId: string) =>
				set((state) => {
					const stories = state.stories.filter((story) => story.id !== storyId);
					if (state.selectedStoryId !== storyId) {
						return { stories };
					}
					const index = state.stories.findIndex((story) => story.id === storyId);
					const next = stories[Math.min(index, stories.length - 1)] ?? null;
					return { stories, selectedStoryId: next?.id ?? null, selectedSceneId: null, reader: null };
				});

			/** Reads the story again (after a failed change, after a generation). A story the backend no longer knows leaves
			 *  the list. Failures are reported. */
			const refreshStory = async (storyId: string): Promise<Story | null> => {
				try {
					return applyServerStory(await enqueue(storyId, () => api.getStory(storyId)));
				} catch (error) {
					if (isNotFound(error)) {
						removeStoryLocally(storyId);
						return null;
					}
					reportError(error, 'Could not read the story');
					return null;
				}
			};

			/** One write of a story: its answer replaces the story. Failures reported under `failureTitle`. */
			const write = async (storyId: string, failureTitle: string, request: () => Promise<Story>): Promise<Story | null> => {
				try {
					return applyServerStory(await enqueue(storyId, request));
				} catch (error) {
					reportError(error, failureTitle);
					if (isNotFound(error)) {
						await refreshStory(storyId);
					}
					return null;
				}
			};

			const moveResult = (story: Story | null, sceneId: string, moved: boolean): BoardMoveResult | null => {
				const position = story ? boardPositionOf(story.scenes.map((scene) => scene.id), sceneId) : null;
				return position ? { ...position, moved } : null;
			};

			const reorder = async (storyId: string, sceneId: string, order: string[] | null): Promise<BoardMoveResult | null> => {
				const story = findStory(storyId);
				if (!story || !story.scenes.some((scene) => scene.id === sceneId)) {
					return null;
				}
				if (order === null) {
					return moveResult(story, sceneId, false);
				}
				const saved = await get().setSceneOrder(storyId, order);
				return saved ? moveResult(saved, sceneId, true) : null;
			};

			return {
				stories: [],
				loadStatus: 'idle',
				loadError: null,
				selectedStoryId: null,
				selectedSceneId: null,
				reader: null,
				generation: null,
				exportingIds: {},
				dockCollapsed: false,

				load: async () => {
					const token = ++loadToken;
					set({ loadStatus: 'loading', loadError: null });
					try {
						const collection = await api.listStories();
						if (token !== loadToken) {
							return;
						}
						set((state) => {
							const selected = collection.items.find((story) => story.id === state.selectedStoryId) ?? collection.items[0] ?? null;
							const keepScene = selected?.id === state.selectedStoryId && selected.scenes.some((scene) => scene.id === state.selectedSceneId);
							return {
								stories: collection.items,
								loadStatus: 'ready',
								selectedStoryId: selected?.id ?? null,
								selectedSceneId: keepScene ? state.selectedSceneId : null,
								reader: selected?.id === state.selectedStoryId ? state.reader : null,
							};
						});
					} catch (error) {
						if (token === loadToken) {
							set({ loadStatus: 'failed', loadError: describeError(error) });
						}
					}
				},

				createStory: async ({ title, characterIds = [] } = {}) => {
					try {
						const story = await api.createStory({ title: title?.trim() || newStoryTitle(get().stories), character_ids: characterIds });
						set((state) => ({ stories: withStory(state.stories, story), selectedStoryId: story.id, selectedSceneId: null, reader: null }));
						return story;
					} catch (error) {
						reportError(error, STORY_FAILURES.create);
						return null;
					}
				},

				updateStory: (storyId, patch) => write(storyId, STORY_FAILURES.update, () => api.updateStory(storyId, patch)),

				deleteStory: async (storyId) => {
					const story = findStory(storyId);
					if (!story) {
						return false;
					}
					try {
						await enqueue(storyId, () => api.deleteStory(storyId));
					} catch (error) {
						reportError(error, STORY_FAILURES.delete);
						return false;
					}
					if (get().generation?.storyId === storyId) {
						await get().cancelGeneration();
					}
					removeStoryLocally(storyId);
					notify('success', `${story.title} was deleted.`);
					return true;
				},

				selectStory: (storyId) => {
					if (storyId === get().selectedStoryId || (storyId !== null && !findStory(storyId))) {
						return;
					}
					set({ selectedStoryId: storyId, selectedSceneId: null, reader: null });
				},

				selectScene: (sceneId) => {
					const story = selectSelectedStory(get());
					if (sceneId === get().selectedSceneId || (sceneId !== null && !story?.scenes.some((scene) => scene.id === sceneId))) {
						return;
					}
					set({ selectedSceneId: sceneId });
				},

				addScene: async (storyId, request = { text: '' }) => {
					const before = new Set(findStory(storyId)?.scenes.map((scene) => scene.id) ?? []);
					const saved = await write(storyId, STORY_FAILURES.addScene, () => api.addScene(storyId, request));
					const scene = saved?.scenes.find((item) => !before.has(item.id)) ?? null;
					if (saved && scene) {
						set({ selectedStoryId: saved.id, selectedSceneId: scene.id });
					}
					return scene;
				},

				updateScene: async (storyId, sceneId, patch) => {
					const story = findStory(storyId);
					if (!story || !story.scenes.some((scene) => scene.id === sceneId)) {
						return null;
					}
					const change: PendingChange = { token: ++changeToken, apply: (current) => withScenePatch(current, sceneId, patch) };
					pendingChanges.set(storyId, [...(pendingChanges.get(storyId) ?? []), change]);
					set((state) => ({ stories: withStory(state.stories, change.apply(story)) }));
					const settle = () => {
						const remaining = (pendingChanges.get(storyId) ?? []).filter((item) => item.token !== change.token);
						if (remaining.length > 0) {
							pendingChanges.set(storyId, remaining);
						} else {
							pendingChanges.delete(storyId);
						}
					};
					try {
						const saved = await enqueue(storyId, () => api.updateScene(storyId, sceneId, patch));
						settle();
						return applyServerStory(saved);
					} catch (error) {
						settle();
						reportError(error, STORY_FAILURES.updateScene);
						await refreshStory(storyId);
						return null;
					}
				},

				lockSubPrompt: async (storyId, sceneId, categoryName, promptText) => {
					const scene = selectScene(storyId, sceneId)(get());
					return scene ? get().updateScene(storyId, sceneId, { locks: withSceneLock(scene.locks, categoryName, promptText) }) : null;
				},

				unlockCategory: async (storyId, sceneId, categoryName) => {
					const scene = selectScene(storyId, sceneId)(get());
					return scene ? get().updateScene(storyId, sceneId, { locks: withoutSceneLock(scene.locks, categoryName) }) : null;
				},

				duplicateScene: async (storyId, sceneId) => {
					const before = new Set(findStory(storyId)?.scenes.map((scene) => scene.id) ?? []);
					const saved = await write(storyId, STORY_FAILURES.duplicate, () => api.duplicateScene(storyId, sceneId));
					const copy = saved?.scenes.find((scene) => !before.has(scene.id)) ?? null;
					if (copy && get().selectedStoryId === storyId) {
						set({ selectedSceneId: copy.id });
					}
					return copy;
				},

				deleteScene: async (storyId, sceneId) => {
					const story = findStory(storyId);
					const index = story?.scenes.findIndex((scene) => scene.id === sceneId) ?? -1;
					if (!story || index < 0) {
						return false;
					}
					const saved = await write(storyId, STORY_FAILURES.deleteScene, () => api.deleteScene(storyId, sceneId));
					if (!saved) {
						return false;
					}
					set((state) => {
						if (state.selectedStoryId !== storyId || state.selectedSceneId !== sceneId) {
							return state;
						}
						const neighbour = saved.scenes[Math.min(index, saved.scenes.length - 1)] ?? null;
						return { selectedSceneId: neighbour?.id ?? null };
					});
					return true;
				},

				moveScene: (storyId, sceneId, move) => {
					const ids = findStory(storyId)?.scenes.map((scene) => scene.id) ?? [];
					return reorder(storyId, sceneId, sceneOrderAfterMove(ids, sceneId, move));
				},

				moveSceneNextTo: (storyId, sceneId, targetId, placement) => {
					const ids = findStory(storyId)?.scenes.map((scene) => scene.id) ?? [];
					return reorder(storyId, sceneId, ids.includes(targetId) ? sceneOrderAfterDrop(ids, sceneId, targetId, placement) : null);
				},

				setSceneOrder: (storyId, sceneIds) => write(storyId, STORY_FAILURES.order, () => api.reorderScenes(storyId, sceneIds)),

				generateScene: async (storyId, sceneId) => (await get().generateScenes(storyId, [sceneId]))[0] ?? null,

				generateScenes: async (storyId, sceneIds) => {
					const story = findStory(storyId);
					const ids = sceneIds.filter((sceneId) => story?.scenes.some((scene) => scene.id === sceneId));
					if (!story || ids.length === 0) {
						return [];
					}
					const generationState = useGenerationStore.getState();
					if (get().generation || generationState.generating || generationState.continuous) {
						notify('warning', GENERATION_BUSY_MESSAGE);
						return [];
					}
					const run = ++generationRun;
					const records: OutputRecord[] = [];
					const warnedCharacterIds = new Set<string>();
					set({ generation: { storyId, currentSceneId: null, queuedSceneIds: ids, completed: 0, total: ids.length } });
					try {
						for (const [index, sceneId] of ids.entries()) {
							if (run !== generationRun) {
								break;
							}
							set((state) => ({
								generation: state.generation && { ...state.generation, currentSceneId: sceneId, queuedSceneIds: ids.slice(index + 1) },
							}));
							const current = findStory(storyId);
							const scene = current?.scenes.find((item) => item.id === sceneId);
							if (!current || !scene) {
								continue; // deleted meanwhile
							}
							const characters = useCharactersStore.getState();
							const { input, missingCharacterIds } = sceneGenerationInput(current, scene, characters.characters, selectActiveCharacter(characters));
							const newlyMissing = missingCharacterIds.filter((id) => !warnedCharacterIds.has(id));
							if (newlyMissing.length > 0) {
								newlyMissing.forEach((id) => warnedCharacterIds.add(id));
								notify('warning', `Characters that no longer exist were left out: ${newlyMissing.join(', ')}.`, { title: 'Missing characters' });
							}
							try {
								records.push(await useGenerationStore.getState().generateScene(input));
							} catch (error) {
								if (!isAbortError(error) && run === generationRun) {
									reportError(error, `${STORY_FAILURES.generate}: ${scene.title}`);
								}
								break;
							}
							set((state) => ({ generation: state.generation && { ...state.generation, completed: state.generation.completed + 1 } }));
							await refreshStory(storyId);
						}
					} finally {
						if (run === generationRun) {
							set({ generation: null });
						}
					}
					if (ids.length > 1 && records.length === ids.length) {
						const elsewhere = useNavigationStore.getState().section !== 'story';
						notify('success', `${records.length} scenes of ${story.title} were illustrated.`, elsewhere ? { action: goToSectionAction('story') } : {});
					}
					return records;
				},

				generateMissing: (storyId) => {
					const story = findStory(storyId);
					return story ? get().generateScenes(storyId, missingSceneIds(story, selectOutputIdSet(useOutputsStore.getState()))) : Promise.resolve([]);
				},

				cancelGeneration: async () => {
					if (!get().generation) {
						return;
					}
					generationRun += 1;
					set({ generation: null });
					await useGenerationStore.getState().cancel();
				},

				chooseVariant: (storyId, sceneId, outputId) =>
					write(storyId, STORY_FAILURES.variant, () => api.chooseSceneVariant(storyId, sceneId, outputId)),

				addVariant: (storyId, sceneId, outputId) => write(storyId, STORY_FAILURES.variant, () => api.addSceneVariant(storyId, sceneId, outputId)),

				removeVariant: (storyId, sceneId, outputId) =>
					write(storyId, STORY_FAILURES.variant, () => api.removeSceneVariant(storyId, sceneId, outputId)),

				addSceneFromOutput: async (storyId) => {
					const { record } = useOutputsStore.getState();
					if (!record) {
						notify('warning', 'There is no output to add to a story: generate or open an output first.');
						return null;
					}
					let story = storyId === null ? null : findStory(storyId);
					if (storyId !== null && !story) {
						return null;
					}
					if (story === null) {
						story = await get().createStory({ characterIds: storyCharacterIdsFromOutput(record) });
						if (!story) {
							return null;
						}
					}
					const request = sceneFromOutput(record, story.character_ids, useCharactersStore.getState().characters, useCategoriesStore.getState().categories);
					const scene = await get().addScene(story.id, request);
					if (scene) {
						const elsewhere = useNavigationStore.getState().section !== 'story';
						notify('success', `${scene.title} was added to ${story.title}.`, elsewhere ? { action: goToSectionAction('story') } : {});
					}
					return scene;
				},

				openReader: (page) => {
					const story = selectSelectedStory(get());
					if (!story) {
						return;
					}
					const selectedIndex = story.scenes.findIndex((scene) => scene.id === get().selectedSceneId);
					const target = clampReaderPage(page ?? Math.max(selectedIndex, 0), story.scenes.length);
					set({ reader: { page: target }, selectedSceneId: story.scenes[target]?.id ?? null });
				},

				closeReader: () => {
					if (get().reader) {
						set({ reader: null });
					}
				},

				setReaderPage: (page) => {
					const story = selectSelectedStory(get());
					if (!story || !get().reader) {
						return;
					}
					const target = clampReaderPage(page, story.scenes.length);
					set({ reader: { page: target }, selectedSceneId: story.scenes[target]?.id ?? null });
				},

				exportStory: async (storyId) => {
					const story = findStory(storyId);
					if (!story || get().exportingIds[storyId]) {
						return false;
					}
					set((state) => ({ exportingIds: withFlag(state.exportingIds, storyId, true) }));
					try {
						const html = await api.exportStory(storyId);
						const fileName = storyExportFileName(story.title);
						if (desktop.isAvailable()) {
							const path = await desktop.saveTextFile({ title: 'Export story', defaultPath: fileName, filters: EXPORT_FILE_FILTERS, content: html });
							if (path === null) {
								return false;
							}
							notify('success', `${story.title} was exported to ${path}.`);
						} else {
							download.text(fileName, html, 'text/html');
							notify('success', `${story.title} was downloaded as ${fileName}.`);
						}
						return true;
					} catch (error) {
						reportError(error, STORY_FAILURES.export);
						return false;
					} finally {
						set((state) => ({ exportingIds: withFlag(state.exportingIds, storyId, false) }));
					}
				},

				setDockCollapsed: (collapsed) => {
					if (get().dockCollapsed !== collapsed) {
						set({ dockCollapsed: collapsed });
					}
				},
			};
		},
		persistedStoreOptions<StoryStore, PersistedStoryState>({
			name: STORE_NAMES.story,
			version: 0,
			partialize: (state) => ({ dockCollapsed: state.dockCollapsed }),
			merge: (persisted, current) =>
				isRecord(persisted) && typeof persisted.dockCollapsed === 'boolean' ? { ...current, dockCollapsed: persisted.dockCollapsed } : current,
		}),
	),
);

function isNotFound(error: unknown): boolean {
	return error instanceof ApiError && error.status === 404;
}

// ---------------------------------------------------------------------------
// Selectors / hooks (views read through these; nothing derived is stored)
// ---------------------------------------------------------------------------

export const selectStory =
	(storyId: string | null) =>
	(state: StoryState): Story | null =>
		storyId === null ? null : (state.stories.find((story) => story.id === storyId) ?? null);

export const selectSelectedStory = (state: StoryState): Story | null => selectStory(state.selectedStoryId)(state);

export const selectScene =
	(storyId: string | null, sceneId: string | null) =>
	(state: StoryState): Scene | null =>
		sceneId === null ? null : (selectStory(storyId)(state)?.scenes.find((scene) => scene.id === sceneId) ?? null);

/** The selected scene of the selected story (null when none is selected or it no longer exists). */
export const selectSelectedScene = (state: StoryState): Scene | null => selectScene(state.selectedStoryId, state.selectedSceneId)(state);

/** The running generation run when it is one of `storyId`'s (null otherwise). */
export const selectStoryGeneration =
	(storyId: string | null) =>
	(state: StoryState): StoryGeneration | null =>
		state.generation !== null && state.generation.storyId === storyId ? state.generation : null;

/** The output ids on disk (which variants can be shown). */
export function useOutputIdSet(): ReadonlySet<string> {
	return useOutputsStore(selectOutputIdSet);
}

/** The status of a scene's illustration (sceneStatus: generating, queued, illustrated, missing). */
export function useSceneStatus(storyId: string, scene: Scene): SceneStatus {
	const outputIds = useOutputIdSet();
	const generation = useStoryStore(selectStoryGeneration(storyId));
	return sceneStatus(scene, outputIds, generation);
}

/** The scenes of a story without an illustration, in story order (what Generate missing illustrates). Memoized. */
export function useMissingSceneIds(storyId: string | null): string[] {
	const story = useStoryStore(selectStory(storyId));
	const outputIds = useOutputIdSet();
	return useMemo(() => (story ? missingSceneIds(story, outputIds) : []), [story, outputIds]);
}

/** Scenes can be illustrated now: a model is selected and no generation (of Create or of a story) is running. */
export function useCanGenerateScenes(): boolean {
	const hasModel = useLibraryStore((state) => selectSelectedModel(state) != null);
	const busy = useGenerationStore((state) => state.generating || state.continuous);
	const running = useStoryStore((state) => state.generation !== null);
	return hasModel && !busy && !running;
}
