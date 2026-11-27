// The co-writer doing a whole story in the real browser, scripted with the fake Codex (backend/tests/fake_codex.py,
// reached by the real backend like the installed Codex) calling the app's tools: create a character and outline a
// story in one call -> per-frame tags, locks, LoRAs and seeds in bulk -> preview a scene's prompt -> illustrate every
// scene with the fake generator -> look at the pictures and check the consistency -> fix a scene (new seed, new
// picture, a reference image for the character). After each step the storyboard, the scene details and the backend
// show the change, and the conversation describes it (Markdown answers, tool rows with links to scenes and the
// character).
import type { Character, CharacterCollection, OutputRecord, Story, StoryCollection } from '../../src/api/types';
import { CO_WRITER_LABELS } from '../../src/features/coWriter/coWriterLabels';
import { STORY_LABELS } from '../../src/features/story/storyLabels';
import { expectPicturesLoaded } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { expectNoPageOverflow } from '../support/shell';
import { assertAppVisible, expectNoHorizontalOverflow } from '../support/visibility';
import { CoWriterDriver, rule } from './coWriterDriver';
import { backendOutput, StoryDriver } from './storyDriver';

const STORY_ID = '{context.story_id}';
const TITLES = ['Last ferry', 'Crossing', 'Arrival'] as const;

const CAST_AND_OUTLINE = rule(
	'outline',
	{ say: 'Creating Lina, then the whole outline.' },
	{
		tool: 'create_character',
		arguments: {
			name: 'Lina',
			identity_tags: ['1girl', 'black hair', 'short ponytail', 'brown eyes'],
			outfit_tags: ['yellow raincoat'],
			loras: [{ lora: 'Watercolor Wash', weight: 0.5 }],
			seed: 4242,
			seed_locked: true,
		},
		as: 'lina',
	},
	{
		tool: 'create_story',
		arguments: {
			title: 'The night ferry',
			character_ids: ['{lina.json.character_id}'],
			logline: 'Lina crosses the bay on the last ferry of the night.',
			style_notes: 'soft watercolor, deep blues, warm lamp light',
			scenes: [
				{ title: TITLES[0], beat: 'Lina runs for the ferry', text: 'Lina reaches the pier as the horn sounds.', shot: 'wide shot', setting: 'harbor pier, night', mood: 'urgent', extra_tags: ['pier', 'night', 'running'] },
				{ title: TITLES[1], beat: 'The storm rises', text: 'Halfway across, the wind turns.', shot: 'medium shot', setting: 'ferry deck', mood: 'tense', extra_tags: ['ferry deck', 'wind', 'holding railing'] },
				{ title: TITLES[2], beat: 'Home at dawn', text: 'At dawn the lights of home appear.', shot: 'from behind', setting: 'island harbor, dawn', mood: 'relief', extra_tags: ['dawn', 'harbor lights', 'smile'] },
			],
		},
		as: 'story',
	},
	{ say: '**Ready.** {story.summary}:\n\n- {lina.summary}, seed locked\n- `{story.json.scenes.0.title}`, `{story.json.scenes.1.title}` and `{story.json.scenes.2.title}`' },
);

const PER_FRAME_TAGS = rule(
	'tags',
	{ tool: 'get_story', arguments: { story_id: STORY_ID }, as: 'story' },
	{
		tool: 'update_scenes',
		arguments: {
			story_id: STORY_ID,
			changes: [
				{ scene_ids: 'all', add_negative_tags: ['lowres', 'blurry'], set_loras: [{ lora: 'sharp_lineart.safetensors', weight: 0.4 }] },
				{ scene_id: '{story.json.scenes.1.scene_id}', lock: [{ category: 'Weather effects', sub_prompt: 'lightning bolts' }], add_tags: ['rain'] },
				{ scene_id: '{story.json.scenes.2.scene_id}', seed: 1234, lock: [{ category: 'Mood', sub_prompt: 'smiling' }], remove_tags: ['smile'] },
			],
		},
	},
	{ say: 'Done: {last.summary}.' },
);

const PREVIEW = rule(
	'preview',
	{ tool: 'get_story', arguments: { story_id: STORY_ID }, as: 'story' },
	{ tool: 'preview_scenes', arguments: { story_id: STORY_ID, scene_ids: ['{story.json.scenes.1.scene_id}'] } },
	{ say: 'Crossing will use `{last.json.scenes.0.prompt}` with seed {last.json.scenes.0.seed} ({last.json.scenes.0.seed_from}).' },
);

const ILLUSTRATE = rule('illustrate', { tool: 'generate_scenes', arguments: { story_id: STORY_ID } }, { say: '{last.summary}.' });

const CHECK = rule(
	'check',
	{ tool: 'view_images', arguments: { story_id: STORY_ID }, as: 'seen' },
	{ tool: 'consistency_report', arguments: { story_id: STORY_ID } },
	{ say: 'I looked at {seen.images} pictures. {last.summary}.' },
);

const FIX = rule(
	'fix',
	{ tool: 'get_story', arguments: { story_id: STORY_ID }, as: 'story' },
	{ tool: 'update_scenes', arguments: { story_id: STORY_ID, changes: [{ scene_id: '{story.json.scenes.1.scene_id}', add_tags: ['lighthouse in the distance'], seed: 77 }] } },
	{ tool: 'generate_scenes', arguments: { story_id: STORY_ID, scene_ids: ['{story.json.scenes.1.scene_id}'] } },
	{ tool: 'update_character', arguments: { character_id: '{story.json.characters.0.character_id}', add_reference_scenes: [{ story_id: STORY_ID, scene_id: '{story.json.scenes.1.scene_id}' }] } },
	{ say: 'Fixed the crossing. {last.summary}.' },
);

test.describe('the co-writer tells a whole story', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 20 }, codex: { delta_delay_ms: 5, rules: [CAST_AND_OUTLINE, PER_FRAME_TAGS, PREVIEW, ILLUSTRATE, CHECK, FIX] } } });

	test('characters, outline, per-frame tags, preview, pictures, a consistency check and a fix, step by step in the storyboard', async ({ app, page, backend }, testInfo) => {
		test.setTimeout(180_000);
		const story = new StoryDriver(app);
		await app.open();
		await story.open();
		const coWriter = new CoWriterDriver(story);
		await coWriter.expectState('ready');

		// 1. A character and the whole outline in one message.
		await coWriter.send('Create Lina and outline the night ferry story');
		await coWriter.waitForAnswer();
		const characters = (await backend.get<CharacterCollection>('/api/characters')).items;
		const lina = characters.find((item) => item.name === 'Lina') as Character;
		expect(lina).toMatchObject({ identity_tags: ['1girl', 'black hair', 'short ponytail', 'brown eyes'], outfit_tags: ['yellow raincoat'], loras: [{ id: 'watercolor-wash-safetensors', weight: 0.5 }], seed: 4242, seed_locked: true });
		const created = (await backend.get<StoryCollection>('/api/stories')).items.find((item) => item.title === 'The night ferry') as Story;
		expect(created).toMatchObject({ character_ids: [lina.id], logline: 'Lina crosses the bay on the last ferry of the night.', style_notes: 'soft watercolor, deep blues, warm lamp light' });
		expect(created.scenes.map((item) => [item.title, item.beat, item.shot, item.setting, item.mood])).toEqual([
			[TITLES[0], 'Lina runs for the ferry', 'wide shot', 'harbor pier, night', 'urgent'],
			[TITLES[1], 'The storm rises', 'medium shot', 'ferry deck', 'tense'],
			[TITLES[2], 'Home at dawn', 'from behind', 'island harbor, dawn', 'relief'],
		]);
		await expect(story.storyItem('The night ferry')).toHaveAttribute('aria-current', 'true');
		expect(await story.cardTitles()).toEqual([...TITLES]);
		await expect(story.scenes().getByRole('textbox', { name: STORY_LABELS.logline, exact: true })).toHaveValue('Lina crosses the bay on the last ferry of the night.');
		const details = story.details();
		await expect(details.getByRole('heading', { level: 2, name: TITLES[0], exact: true })).toBeVisible();
		await expect(details.getByRole('textbox', { name: STORY_LABELS.beat, exact: true })).toHaveValue('Lina runs for the ferry');
		await expect(details.getByRole('textbox', { name: STORY_LABELS.shot, exact: true })).toHaveValue('wide shot');
		await expect(details.getByText('In this scene: Lina', { exact: true })).toBeVisible();
		await expect(coWriter.entries('tool')).toHaveText(['Created LinaShow', 'Created The night ferry with 3 scenesShow']);
		// The answer is Markdown: bold, a list, inline code; never HTML.
		const answer = coWriter.entries('assistant').last();
		await expect(answer.locator('strong')).toHaveText('Ready.');
		await expect(answer.getByRole('listitem')).toHaveText(['Created Lina, seed locked', `${TITLES[0]}, ${TITLES[1]} and ${TITLES[2]}`]);
		await expect(answer.locator('code')).toHaveText([...TITLES]);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'journey-1-outline');

		// The character's activity links to the character.
		await coWriter.showLink('Lina').click();
		await expect(app.section('characters').getByRole('heading', { level: 2, name: 'Lina', exact: true })).toBeVisible();
		await story.open();

		// 2. Per-frame tags, locks, LoRAs and seeds for every scene in one call.
		await coWriter.send('Set the tags of every frame');
		await coWriter.waitForAnswer();
		await expect(coWriter.entries('tool').last()).toHaveText('Edited 3 scenes of The night ferry (tags, negative tags, locked sub-prompts, LoRAs, seed)Show');
		const tagged = (await backend.get<Story>(`/api/stories/${created.id}`)).scenes;
		expect(tagged.map((item) => [item.negative_tags, item.loras])).toEqual(TITLES.map(() => [['lowres', 'blurry'], [{ id: 'sharp-lineart-safetensors', weight: 0.4 }]]));
		expect(tagged[1]).toMatchObject({ extra_tags: ['ferry deck', 'wind', 'holding railing', 'rain'], locks: [{ category_name: 'Weather effects', prompt_text: 'lightning bolts' }] });
		expect(tagged[2]).toMatchObject({ extra_tags: ['dawn', 'harbor lights'], locks: [{ category_name: 'Mood', prompt_text: 'smiling' }], seed: 1234 });
		const crossing = await story.openScene(2, TITLES[1]);
		const sceneLoras = crossing.getByRole('group', { name: STORY_LABELS.sceneLoras, exact: true });
		await expect(sceneLoras.getByRole('listitem')).toHaveText(['sharp_lineart.safetensors']);
		await expect(sceneLoras.getByRole('spinbutton', { name: 'Weight of sharp_lineart.safetensors', exact: true })).toHaveValue('0.4');
		await expect(crossing.getByText('lightning bolts', { exact: true })).toBeVisible();
		await expect(crossing.getByRole('textbox', { name: STORY_LABELS.negativeTags, exact: true })).toHaveValue('lowres, blurry');

		// 3. The preview: the prompt the one request builder makes, with Lina's locked seed.
		await coWriter.send('Preview the crossing');
		await coWriter.waitForAnswer();
		const preview = (await coWriter.entries('assistant').last().textContent()) ?? '';
		expect(preview).toContain('1girl, black hair, short ponytail, brown eyes, yellow raincoat');
		expect(preview).toContain('lightning bolts');
		expect(preview).toContain("with seed 4242 (Lina's locked seed)");
		expect((await backend.state()).generations).toBe(0);

		// 4. Every scene illustrated through the one generate path.
		await coWriter.send('Illustrate the story');
		await coWriter.waitForAnswer(60_000);
		await expect(coWriter.entries('tool').last()).toHaveText('Illustrated 3 of 3 scenes of The night ferryShow');
		for (const [index, title] of TITLES.entries()) {
			await expect(story.status(story.card(index + 1, title))).toHaveText('Illustrated');
		}
		await expectPicturesLoaded(story.scenes());
		const illustrated = (await backend.get<Story>(`/api/stories/${created.id}`)).scenes;
		const pictures: OutputRecord[] = await Promise.all(illustrated.map((item) => backendOutput(backend, item.chosen_output_id!)));
		expect(pictures.map((record) => [record.character?.name, record.image_seed ?? record.seed])).toEqual([
			['Lina', 4242],
			['Lina', 4242],
			['Lina', 1234],
		]);
		expect(pictures[1].active_loras.slice(0, 3)).toEqual([
			{ id: 'watercolor-wash-safetensors', weight: 0.5 },
			{ id: 'sharp-lineart-safetensors', weight: 0.4 },
			{ id: 'local-detail-tweaker-safetensors', weight: -0.5 },
		]);
		expect(pictures[1].prompt).toContain('lightning bolts');
		// Create's negative prompt has 'lowres' already: only 'blurry' is appended.
		expect(pictures[1].negative_prompt).toContain('lowres, bad anatomy, watermark, blurry');

		// 5. Codex looks at the pictures and checks the consistency.
		await coWriter.send('Look at the pictures and check the consistency');
		await coWriter.waitForAnswer();
		const tools = await coWriter.entries('tool').count();
		await expect(coWriter.entries('tool').nth(tools - 2)).toHaveText('Looked at 3 pictures of The night ferryShow');
		await expect(coWriter.entries('tool').last()).toContainText('Checked The night ferry:');
		await expect(coWriter.entries('assistant').last()).toContainText('I looked at 3 pictures. Checked The night ferry:');

		// 6. A fix: a fixed seed and a new tag for the crossing, its new picture, and that picture as Lina's reference.
		await coWriter.send('Fix the crossing');
		await coWriter.waitForAnswer(60_000);
		const fixed = (await backend.get<Story>(`/api/stories/${created.id}`)).scenes[1];
		expect(fixed).toMatchObject({ seed: 77, extra_tags: ['ferry deck', 'wind', 'holding railing', 'rain', 'lighthouse in the distance'] });
		expect(fixed.variants).toHaveLength(2);
		expect((await backendOutput(backend, fixed.chosen_output_id!)).image_seed).toBe(77);
		const linaNow = (await backend.get<CharacterCollection>('/api/characters')).items.find((item) => item.id === lina.id)!;
		expect(linaNow.reference_images.map((image) => image.source)).toEqual([{ kind: 'output', output_id: fixed.chosen_output_id }]);
		await expect(coWriter.entries('tool').last()).toHaveText('Edited Lina (1 reference image added)Show');
		await expect(coWriter.entries('assistant').last()).toHaveText('Fixed the crossing. Edited Lina (1 reference image added).');
		const fixedDetails = await story.openScene(2, TITLES[1]);
		await expect(fixedDetails.getByRole('button', { name: `Variant ${fixed.chosen_output_id}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(fixedDetails.getByRole('textbox', { name: STORY_LABELS.seed, exact: true })).toHaveValue('77');
		await expectPicturesLoaded(fixedDetails);

		await expectNoHorizontalOverflow(coWriter.dock());
		await expectNoPageOverflow(page);
		await assertAppVisible(page);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'journey-6-fixed');
		await coWriter.log().evaluate((log) => (log.scrollTop = 0));
		await expectBaseline(coWriter.dock(), 'co-writer-journey.png');
		await expect(coWriter.button(CO_WRITER_LABELS.send)).toBeVisible();
	});
});
