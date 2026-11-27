// Test doubles of the story store for view tests (imported by tests only): every action is replaced by vi.fn (the
// views are tested against the store contracts, never the real actions); selectStory, selectScene, the reader actions
// and updateScene apply their change so the controlled views behave like in the app.
import { vi } from 'vitest';
import type { OutputRecord, Scene, ScenePatch, Story } from '../api/types';
import { clampReaderPage, withScenePatch } from '../domain/stories';
import { selectSelectedStory, useStoryStore } from '../stores/storyStore';

export function seedStoryActions() {
	const select = () => useStoryStore.getState();
	const actions = {
		load: vi.fn(async () => undefined),
		createStory: vi.fn(async (_fields?: object): Promise<Story | null> => null),
		updateStory: vi.fn(async (_storyId: string, _patch: object): Promise<Story | null> => null),
		deleteStory: vi.fn(async (_storyId: string) => true),
		selectStory: vi.fn((storyId: string | null) => useStoryStore.setState({ selectedStoryId: storyId, selectedSceneId: null, reader: null })),
		selectScene: vi.fn((sceneId: string | null) => useStoryStore.setState({ selectedSceneId: sceneId })),
		addScene: vi.fn(async (_storyId: string, _request?: object): Promise<Scene | null> => null),
		updateScene: vi.fn(async (storyId: string, sceneId: string, patch: ScenePatch): Promise<Story | null> => {
			useStoryStore.setState((state) => ({ stories: state.stories.map((story) => (story.id === storyId ? withScenePatch(story, sceneId, patch) : story)) }));
			return null;
		}),
		addScenes: vi.fn(async (_storyId: string, _requests: readonly object[], _index?: number | null): Promise<Scene[]> => []),
		updateScenes: vi.fn(async (_storyId: string, _patches: readonly object[]): Promise<Story | null> => null),
		lockSubPrompt: vi.fn(async (_storyId: string, _sceneId: string, _category: string, _text: string): Promise<Story | null> => null),
		setSceneLora: vi.fn(async (_storyId: string, _sceneId: string, _loraId: string, _weight?: number): Promise<Story | null> => null),
		removeSceneLora: vi.fn(async (_storyId: string, _sceneId: string, _loraId: string): Promise<Story | null> => null),
		unlockCategory: vi.fn(async (_storyId: string, _sceneId: string, _category: string): Promise<Story | null> => null),
		duplicateScene: vi.fn(async (_storyId: string, _sceneId: string): Promise<Scene | null> => null),
		deleteScene: vi.fn(async (_storyId: string, _sceneId: string) => true),
		moveScene: vi.fn(async (_storyId: string, _sceneId: string, _move: string) => ({ position: 2, total: 3, moved: true })),
		moveSceneNextTo: vi.fn(async (_storyId: string, _sceneId: string, _targetId: string, _placement: string) => null),
		setSceneOrder: vi.fn(async (_storyId: string, _sceneIds: string[]): Promise<Story | null> => null),
		generateScene: vi.fn(async (_storyId: string, _sceneId: string): Promise<OutputRecord | null> => null),
		generateScenes: vi.fn(async (_storyId: string, _sceneIds: string[]): Promise<OutputRecord[]> => []),
		generateMissing: vi.fn(async (_storyId: string): Promise<OutputRecord[]> => []),
		cancelGeneration: vi.fn(async () => undefined),
		chooseVariant: vi.fn(async (_storyId: string, _sceneId: string, _outputId: string): Promise<Story | null> => null),
		addVariant: vi.fn(async (_storyId: string, _sceneId: string, _outputId: string): Promise<Story | null> => null),
		removeVariant: vi.fn(async (_storyId: string, _sceneId: string, _outputId: string): Promise<Story | null> => null),
		addSceneFromOutput: vi.fn(async (_storyId: string | null): Promise<Scene | null> => null),
		openReader: vi.fn((page?: number) => {
			const story = selectSelectedStory(select());
			const target = clampReaderPage(page ?? 0, story?.scenes.length ?? 0);
			useStoryStore.setState({ reader: { page: target }, selectedSceneId: story?.scenes[target]?.id ?? null });
		}),
		closeReader: vi.fn(() => useStoryStore.setState({ reader: null })),
		setReaderPage: vi.fn((page: number) => {
			const story = selectSelectedStory(select());
			const target = clampReaderPage(page, story?.scenes.length ?? 0);
			useStoryStore.setState({ reader: { page: target }, selectedSceneId: story?.scenes[target]?.id ?? null });
		}),
		exportStory: vi.fn(async (_storyId: string) => true),
	};
	useStoryStore.setState(actions);
	return actions;
}
