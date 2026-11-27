// An in-memory stand-in for the stories API (imported by tests only): the api client's story calls are spied on and
// answered from a copy of the given stories, following the backend's rules (services/stories.py: 'Scene <n>' titles,
// insertion at an index, patches of the fields sent, the scene order, '<title> (copy)' duplicates and the variant
// rules), so store and tool tests exercise the real story store actions end to end. Every call is recorded.
import { vi } from 'vitest';
import { ApiError, api } from '../api/client';
import type { Scene, SceneCreateRequest, Story, StoryCreateRequest } from '../api/types';
import { scene as makeScene } from './storyData';

const NOW = '2026-11-27T10:00:00Z';

export type StoryBackend = {
	stories: () => Story[];
	story: (storyId: string) => Story;
};

function notFound(what: string): never {
	throw new ApiError(`${what} not found`, 404, null);
}

/** Spies on the api's story calls and answers them from `initial` (deep-copied). */
export function fakeStoryBackend(initial: readonly Story[]): StoryBackend {
	let stories: Story[] = structuredClone([...initial]);
	let counter = 0x100;
	const nextId = (prefix: 'sty' | 'scn') => `${prefix}-${(counter++).toString(16).padStart(12, '0')}`;
	const find = (storyId: string): Story => stories.find((item) => item.id === storyId) ?? notFound(`Story ${storyId}`);
	const replace = (story: Story): Story => {
		stories = stories.map((item) => (item.id === story.id ? story : item));
		return structuredClone(story);
	};
	const changeScene = (storyId: string, sceneId: string, change: (scene: Scene) => Scene): Story => {
		const story = find(storyId);
		if (!story.scenes.some((item) => item.id === sceneId)) {
			notFound(`Scene ${sceneId}`);
		}
		return replace({ ...story, scenes: story.scenes.map((item) => (item.id === sceneId ? change(item) : item)) });
	};

	vi.spyOn(api, 'listStories').mockImplementation(async () => ({ items: structuredClone(stories) }));
	vi.spyOn(api, 'getStory').mockImplementation(async (storyId) => structuredClone(find(storyId)));
	vi.spyOn(api, 'createStory').mockImplementation(async (request: StoryCreateRequest) => {
		const story: Story = { character_ids: [], ...request, id: nextId('sty'), scenes: [], created_at: NOW, updated_at: NOW } as Story;
		stories = [...stories, story];
		return structuredClone(story);
	});
	vi.spyOn(api, 'updateStory').mockImplementation(async (storyId, patch) => replace({ ...find(storyId), ...patch } as Story));
	vi.spyOn(api, 'deleteStory').mockImplementation(async (storyId) => {
		find(storyId);
		stories = stories.filter((item) => item.id !== storyId);
	});
	vi.spyOn(api, 'addScene').mockImplementation(async (storyId, request: SceneCreateRequest) => {
		const story = find(storyId);
		const { title, index, output_id: outputId, ...fields } = request;
		let scene: Scene = makeScene({ ...fields, id: nextId('scn'), title: title ?? `Scene ${story.scenes.length + 1}` } as Partial<Scene>);
		if (outputId) {
			scene = { ...scene, variants: [{ output_id: outputId, added_at: NOW }], chosen_output_id: outputId };
		}
		const at = index === null || index === undefined ? story.scenes.length : Math.min(index, story.scenes.length);
		return replace({ ...story, scenes: [...story.scenes.slice(0, at), scene, ...story.scenes.slice(at)] });
	});
	vi.spyOn(api, 'updateScene').mockImplementation(async (storyId, sceneId, patch) => changeScene(storyId, sceneId, (scene) => ({ ...scene, ...patch }) as Scene));
	vi.spyOn(api, 'deleteScene').mockImplementation(async (storyId, sceneId) => {
		const story = find(storyId);
		if (!story.scenes.some((item) => item.id === sceneId)) {
			notFound(`Scene ${sceneId}`);
		}
		return replace({ ...story, scenes: story.scenes.filter((item) => item.id !== sceneId) });
	});
	vi.spyOn(api, 'duplicateScene').mockImplementation(async (storyId, sceneId) => {
		const story = find(storyId);
		const index = story.scenes.findIndex((item) => item.id === sceneId);
		if (index < 0) {
			notFound(`Scene ${sceneId}`);
		}
		const copy = { ...structuredClone(story.scenes[index]), id: nextId('scn'), title: `${story.scenes[index].title} (copy)` };
		return replace({ ...story, scenes: [...story.scenes.slice(0, index + 1), copy, ...story.scenes.slice(index + 1)] });
	});
	vi.spyOn(api, 'reorderScenes').mockImplementation(async (storyId, sceneIds) => {
		const story = find(storyId);
		return replace({ ...story, scenes: sceneIds.map((id) => story.scenes.find((item) => item.id === id)!) });
	});
	vi.spyOn(api, 'addSceneVariant').mockImplementation(async (storyId, sceneId, outputId) =>
		changeScene(storyId, sceneId, (scene) => ({
			...scene,
			variants: scene.variants.some((item) => item.output_id === outputId) ? scene.variants : [...scene.variants, { output_id: outputId, added_at: NOW }],
			chosen_output_id: outputId,
		})),
	);
	vi.spyOn(api, 'chooseSceneVariant').mockImplementation(async (storyId, sceneId, outputId) => changeScene(storyId, sceneId, (scene) => ({ ...scene, chosen_output_id: outputId })));
	vi.spyOn(api, 'removeSceneVariant').mockImplementation(async (storyId, sceneId, outputId) =>
		changeScene(storyId, sceneId, (scene) => {
			const variants = scene.variants.filter((item) => item.output_id !== outputId);
			const chosen = scene.chosen_output_id === outputId ? (variants[variants.length - 1]?.output_id ?? null) : scene.chosen_output_id;
			return { ...scene, variants, chosen_output_id: chosen };
		}),
	);
	return { stories: () => structuredClone(stories), story: (storyId) => structuredClone(find(storyId)) };
}
