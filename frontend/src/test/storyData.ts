// Story test data, shared by the domain, store and view tests (imported by tests only): builders with neutral defaults
// (override what a test is about), with the shapes the backend sends (Story, Scene, StoryCollection, OutputRecord with
// a story link).
import type { OutputRecord, Scene, Story, StoryCollection } from '../api/types';
import { ALICE_ID } from './characterData';

export const STORY_ID = 'sty-000000000001';
export const OTHER_STORY_ID = 'sty-000000000002';
export const SCENE_IDS = ['scn-000000000001', 'scn-000000000002', 'scn-000000000003'] as const;

export function scene(overrides: Partial<Scene> = {}): Scene {
	return {
		id: SCENE_IDS[0],
		title: 'Arrival',
		text: 'Mira climbed the stairs.',
		beat: '',
		shot: '',
		setting: '',
		mood: '',
		extra_tags: [],
		negative_tags: [],
		locks: [],
		character_ids: null,
		seed: null,
		loras: [],
		variants: [],
		chosen_output_id: null,
		created_at: '2026-11-24T08:00:00Z',
		updated_at: '2026-11-24T08:00:00Z',
		...overrides,
	};
}

/** A scene illustrated by `outputIds` (variants, oldest first), the last one chosen unless `chosen` says otherwise. */
export function illustratedScene(outputIds: string[], overrides: Partial<Scene> = {}, chosen: string | null = outputIds[outputIds.length - 1] ?? null): Scene {
	return scene({
		variants: outputIds.map((outputId) => ({ output_id: outputId, added_at: '2026-11-24T08:10:00Z' })),
		chosen_output_id: chosen,
		...overrides,
	});
}

/** 'The lighthouse' with Alice as its character and three scenes: illustrated by 0000000001, by 0000000003 (two
 *  variants), not illustrated. */
export function story(overrides: Partial<Story> = {}): Story {
	return {
		id: STORY_ID,
		title: 'The lighthouse',
		character_ids: [ALICE_ID],
		logline: '',
		synopsis: '',
		style_notes: '',
		scenes: [
			illustratedScene(['0000000001'], { id: SCENE_IDS[0], title: 'Arrival' }),
			illustratedScene(['0000000002', '0000000003'], { id: SCENE_IDS[1], title: 'The storm', text: 'The waves rose.', extra_tags: ['storm', 'night'] }),
			scene({ id: SCENE_IDS[2], title: 'Morning calm', text: 'The sun rose.' }),
		],
		created_at: '2026-11-24T08:00:00Z',
		updated_at: '2026-11-24T08:20:00Z',
		...overrides,
	};
}

export function storyCollection(items: Story[] = [story()]): StoryCollection {
	return { items };
}

/** An output record of a scene generation (the fields the stores read). */
export function sceneOutput(outputId: string, overrides: Partial<OutputRecord> = {}): OutputRecord {
	return {
		output_id: outputId,
		image_path: `D:/data/output/${outputId}.png`,
		metadata_path: `D:/data/output/${outputId}.json`,
		generated_at: '2026-11-24T09:00:00Z',
		prompt: '1girl, silver hair, storm',
		negative_prompt: '',
		seed: 7,
		prompt_seed: 3,
		image_seed: 7,
		width: 64,
		height: 64,
		steps: 4,
		guidance_scale: 5,
		model_id: 'model',
		active_loras: [],
		selections: [],
		character: null,
		story: { story_id: STORY_ID, scene_id: SCENE_IDS[2], story_title: 'The lighthouse', scene_title: 'Morning calm' },
		...overrides,
	};
}
