import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { F6_REGION_ATTRIBUTE } from '../../app/sections';
import type { ModelSpec } from '../../api/types';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCharactersStore } from '../../stores/charactersStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { useStoryStore } from '../../stores/storyStore';
import { ALICE_ID, BOB, BOB_ID, character } from '../../test/characterData';
import { openDialog } from '../../test/dialogs';
import { renderWithProviders } from '../../test/render';
import { scene, SCENE_IDS, story, STORY_ID, OTHER_STORY_ID } from '../../test/storyData';
import { seedStoryActions } from '../../test/storyStores';
import { StorySection } from './StorySection';
import { STORY_LABELS } from './storyLabels';

const ALICE = character();
const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };

let actions: ReturnType<typeof seedStoryActions>;

beforeEach(() => {
	actions = seedStoryActions();
	useNavigationStore.setState({ section: 'story', visited: { create: true, story: true } });
	useCharactersStore.setState({ characters: [ALICE, BOB], loadStatus: 'ready' });
	useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'], currentId: '0000000003' });
	useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });
});

function renderSection(state: Partial<ReturnType<typeof useStoryStore.getState>> = {}) {
	useStoryStore.setState({ loadStatus: 'ready', stories: [story(), story({ id: OTHER_STORY_ID, title: "Bram's quest", scenes: [] })], selectedStoryId: STORY_ID, ...state });
	return renderWithProviders(<StorySection />);
}

const storyList = () => screen.getByRole('navigation', { name: STORY_LABELS.storyList });
const scenes = () => screen.getByRole('region', { name: STORY_LABELS.scenes });
const details = () => screen.getByRole('complementary', { name: STORY_LABELS.sceneDetails });
const commands = () => screen.getByRole('toolbar', { name: STORY_LABELS.commands });
const card = (position: number, title: string) => within(scenes()).getByRole('group', { name: `Scene ${position}: ${title}` });

describe('StorySection layout', () => {
	it('shows the commands, the stories, the scene cards in order and the empty scene details', () => {
		renderSection();

		expect(screen.getByRole('heading', { level: 1, name: 'Story' })).toBeInTheDocument();
		expect(within(commands()).getByRole('button', { name: STORY_LABELS.newStory })).toBeEnabled();
		expect(within(commands()).getByRole('button', { name: 'Generate missing (1)' })).toBeEnabled();
		const items = within(storyList()).getAllByRole('button');
		expect(items.map((item) => item.textContent)).toEqual(['The lighthouse3 scenes · 2 illustrated', "Bram's questNo scenes"]);
		expect(items[0]).toHaveAttribute('aria-current', 'true');
		expect(within(within(scenes()).getByRole('list', { name: STORY_LABELS.sceneList })).getAllByRole('listitem')).toHaveLength(4);
		expect(card(1, 'Arrival')).toBeInTheDocument();
		expect(card(2, 'The storm')).toBeInTheDocument();
		expect(within(card(3, 'Morning calm')).getByText('Not illustrated')).toBeInTheDocument();
		expect(within(card(1, 'Arrival')).getByText('Illustrated')).toBeInTheDocument();
		expect(within(scenes()).getByRole('textbox', { name: STORY_LABELS.storyTitle })).toHaveValue('The lighthouse');
		expect(within(details()).getByText('No scene selected')).toBeInTheDocument();
	});

	it('marks its header, story list, scenes and details as F6 regions, in that order', () => {
		const { container } = renderSection();

		const regions = Array.from(container.querySelectorAll(`[${F6_REGION_ATTRIBUTE}]`)).map((element) => element.getAttribute(F6_REGION_ATTRIBUTE));
		expect(regions).toEqual(['toolbar', 'navigation', 'results', 'detail']);
	});

	it('says how to start without stories, and offers New story', async () => {
		const { user } = renderSection({ stories: [], selectedStoryId: null });

		expect(within(scenes()).getByRole('heading', { name: 'Tell a story, picture by picture' })).toBeInTheDocument();
		expect(within(storyList()).getByText('No story yet')).toBeInTheDocument();
		await user.click(within(scenes()).getByRole('button', { name: STORY_LABELS.newStory }));
		expect(actions.createStory).toHaveBeenCalledTimes(1);
		expect(within(commands()).getByRole('button', { name: STORY_LABELS.read })).toBeDisabled();
		expect(within(commands()).getByRole('button', { name: 'Generate missing (0)' })).toBeDisabled();
	});

	it('shows the failure of the stories with Retry', async () => {
		const { user } = renderSection({ stories: [], selectedStoryId: null, loadStatus: 'failed', loadError: 'stories.json cannot be read' });

		expect(within(storyList()).getByRole('alert')).toHaveTextContent('The stories could not be loaded: stories.json cannot be read');
		await user.click(within(storyList()).getByRole('button', { name: 'Retry' }));
		expect(actions.load).toHaveBeenCalledTimes(1);
	});

	it('offers Add scene for a story without scenes', async () => {
		const { user } = renderSection({ selectedStoryId: OTHER_STORY_ID });

		expect(within(scenes()).getByRole('heading', { name: 'No scenes yet' })).toBeInTheDocument();
		await user.click(within(scenes()).getByRole('button', { name: STORY_LABELS.addScene }));
		expect(actions.addScene).toHaveBeenCalledWith(OTHER_STORY_ID);
	});

	it('plugs a dock panel into a docked region after the details', () => {
		const { container } = renderWithProviders(<StorySection dock={{ label: 'Co-writer', component: () => <p>Chat</p> }} />);

		expect(screen.getByRole('complementary', { name: 'Co-writer' })).toHaveTextContent('Chat');
		const regions = Array.from(container.querySelectorAll(`[${F6_REGION_ATTRIBUTE}]`)).map((element) => element.getAttribute(F6_REGION_ATTRIBUTE));
		expect(regions[regions.length - 1]).toBe('dock');
	});
});

describe('StorySection commands', () => {
	it('selects a story, generates the missing scenes, reads and exports through the store', async () => {
		const { user } = renderSection();

		await user.click(within(storyList()).getByRole('button', { name: /Bram's quest/ }));
		expect(actions.selectStory).toHaveBeenCalledWith(OTHER_STORY_ID);
		act(() => useStoryStore.setState({ selectedStoryId: STORY_ID }));

		await user.click(within(commands()).getByRole('button', { name: 'Generate missing (1)' }));
		expect(actions.generateMissing).toHaveBeenCalledWith(STORY_ID);
		await user.click(within(commands()).getByRole('button', { name: STORY_LABELS.exportStory }));
		expect(actions.exportStory).toHaveBeenCalledWith(STORY_ID);
		await user.click(within(commands()).getByRole('button', { name: STORY_LABELS.read }));
		expect(actions.openReader).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('region', { name: STORY_LABELS.reader })).toBeInTheDocument();
	});

	it('shows the run progress and Cancel while scenes are generated', async () => {
		const { user } = renderSection({
			generation: { storyId: STORY_ID, currentSceneId: SCENE_IDS[2], queuedSceneIds: [], completed: 1, total: 2 },
		});

		expect(screen.getByRole('status', { name: 'Generating: Scene 2 of 2 · Morning calm' })).toBeInTheDocument();
		expect(within(card(3, 'Morning calm')).getByText('Generating')).toBeInTheDocument();
		// No other generation can start meanwhile.
		expect(within(card(1, 'Arrival')).getByRole('button', { name: STORY_LABELS.regenerate })).toBeDisabled();
		await user.click(within(commands()).getByRole('button', { name: STORY_LABELS.cancelGeneration }));
		expect(actions.cancelGeneration).toHaveBeenCalledTimes(1);
	});

	it('renames the story when the title edit is done, and refuses a blank title', async () => {
		const { user } = renderSection();
		const title = within(scenes()).getByRole('textbox', { name: STORY_LABELS.storyTitle });

		await user.clear(title);
		await user.tab();
		expect(actions.updateStory).not.toHaveBeenCalled();
		expect(title).toHaveValue('The lighthouse');

		await user.clear(title);
		await user.type(title, 'The keeper{Enter}');
		expect(actions.updateStory).toHaveBeenCalledWith(STORY_ID, { title: 'The keeper' });
	});
});

describe('scene cards', () => {
	it('select their scene, generate, duplicate and delete it (after a confirmation)', async () => {
		const { user } = renderSection();
		const storm = card(2, 'The storm');

		await user.click(within(storm).getByRole('button', { name: 'The storm' }));
		expect(actions.selectScene).toHaveBeenCalledWith(SCENE_IDS[1]);
		expect(within(storm).getByRole('button', { name: 'The storm' })).toHaveAttribute('aria-current', 'true');

		await user.click(within(card(3, 'Morning calm')).getByRole('button', { name: STORY_LABELS.generate }));
		expect(actions.generateScene).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[2]);
		await user.click(within(storm).getByRole('button', { name: 'Duplicate scene The storm' }));
		expect(actions.duplicateScene).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[1]);
		const dialog = await openDialog(user, within(storm).getByRole('button', { name: 'Delete scene The storm' }), 'alertdialog');
		expect(dialog).toHaveTextContent("Delete scene 'The storm'?");
		await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
		expect(actions.deleteScene).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[1]);
	});

	it('move with their reorder handle and announce the new position', async () => {
		const { user } = renderSection();
		const handle = within(card(1, 'Arrival')).getByRole('button', { name: 'Reorder Arrival' });

		handle.focus();
		await user.keyboard('{ArrowRight}');

		expect(actions.moveScene).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[0], 'next');
		expect(await within(scenes()).findByText('Arrival moved to position 2 of 3')).toBeInTheDocument();
	});
});

describe('scene details', () => {
	function renderScene(sceneId: string = SCENE_IDS[1], stories = [story()]) {
		useCategoriesStore.setState({
			categories: [
				{ text: 'Mood', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'calm', state: 'normal', extraLoraIds: [] }, { text: 'smiling', state: 'normal', extraLoraIds: [] }] },
			],
		});
		return renderSection({ stories, selectedSceneId: sceneId });
	}

	it('shows the picture, the variants, the text and the prompt of the scene', async () => {
		const { user } = renderScene();
		const panel = details();

		expect(within(panel).getByRole('heading', { level: 2, name: 'The storm' })).toBeInTheDocument();
		expect(within(panel).getByRole('img', { name: 'Illustration of The storm' })).toHaveAttribute('src', expect.stringContaining('/api/outputs/0000000003/image'));
		expect(within(panel).getByRole('button', { name: 'Variant 0000000003' })).toHaveAttribute('aria-pressed', 'true');
		await user.click(within(panel).getByRole('button', { name: 'Variant 0000000002' }));
		expect(actions.chooseVariant).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[1], '0000000002');
		expect(within(panel).getByRole('textbox', { name: STORY_LABELS.sceneText })).toHaveValue('The waves rose.');
		expect(within(panel).getByRole('textbox', { name: STORY_LABELS.extraTags })).toHaveValue('storm, night');
		// The current output of Create is the chosen picture already.
		expect(within(panel).getByRole('button', { name: STORY_LABELS.useCurrentOutput })).toBeDisabled();
	});

	it('saves the text when the edit is done, Ctrl+Enter too; Escape puts it back', async () => {
		const { user } = renderScene();
		const text = within(details()).getByRole('textbox', { name: STORY_LABELS.sceneText });

		await user.click(text);
		await user.keyboard('{End} The light held.');
		await user.tab();
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[1], { text: 'The waves rose. The light held.' });

		await user.click(text);
		await user.keyboard('{End} Again.');
		await user.keyboard('{Escape}');
		expect(text).toHaveValue('The waves rose. The light held.');
		await user.keyboard('{End} Dawn.{Control>}{Enter}{/Control}');
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[1], { text: 'The waves rose. The light held. Dawn.' });
	});

	it('saves the tags as tags, locks a sub-prompt and unlocks one', async () => {
		const { user } = renderScene(SCENE_IDS[0], [story({ scenes: [scene({ locks: [{ category_name: 'Mood', prompt_text: 'calm' }] })] })]);
		const panel = details();

		const tags = within(panel).getByRole('textbox', { name: STORY_LABELS.negativeTags });
		await user.type(tags, 'sunny,, blurry ');
		await user.tab();
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[0], { negative_tags: ['sunny', 'blurry'] });

		await user.click(within(panel).getByRole('combobox', { name: STORY_LABELS.lockSubPrompt }));
		await user.click(await screen.findByRole('option', { name: 'smiling' }));
		expect(actions.lockSubPrompt).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[0], 'Mood', 'smiling');

		await user.click(within(panel).getByRole('button', { name: 'Unlock Mood' }));
		expect(actions.unlockCategory).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[0], 'Mood');
	});

	it("uses the story's characters until the scene names its own", async () => {
		const { user } = renderScene();
		const panel = details();

		expect(within(panel).getByText('In this scene: Alice')).toBeInTheDocument();
		await user.click(within(panel).getByRole('switch', { name: STORY_LABELS.sameCharacters }));
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[1], { character_ids: [ALICE_ID] });
		expect(within(details()).getByRole('combobox', { name: STORY_LABELS.sceneCharacters })).toHaveTextContent('Alice');
		await user.click(within(details()).getByRole('combobox', { name: STORY_LABELS.sceneCharacters }));
		// A multiselect dropdown's options are checkbox menu items.
		await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Bob' }));
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[1], { character_ids: [ALICE_ID, BOB_ID] });
	});

	it('takes a fixed seed (whole numbers of 0 or more), and Random seed clears it', async () => {
		const { user } = renderScene();
		const seed = within(details()).getByRole('textbox', { name: STORY_LABELS.seed });

		await user.type(seed, '-4');
		await user.tab();
		expect(await within(details()).findByText('The seed must be a whole number of 0 or more.')).toBeInTheDocument();
		expect(seed).toHaveValue('');

		await user.type(seed, '1234');
		await user.tab();
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[1], { seed: 1234 });
		await user.click(within(details()).getByRole('button', { name: STORY_LABELS.randomSeed }));
		expect(actions.updateScene).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[1], { seed: null });
	});

	it('closes with Escape or Close, back to the card', async () => {
		const { user } = renderScene();

		await user.click(within(details()).getByRole('button', { name: 'Close details' }));

		expect(actions.selectScene).toHaveBeenLastCalledWith(null);
		expect(within(card(2, 'The storm')).getByRole('button', { name: 'The storm' })).toHaveFocus();
	});
});

describe('reader', () => {
	it('shows one scene per page and turns pages with the keys; Escape closes it', () => {
		renderSection({ reader: { page: 0 }, selectedSceneId: SCENE_IDS[0] });
		const reader = screen.getByRole('region', { name: STORY_LABELS.reader });
		const book = within(reader).getByRole('group', { name: 'The lighthouse, Page 1 of 3' });

		expect(book).toHaveFocus();
		expect(within(reader).getByRole('img', { name: 'Illustration of Arrival' })).toBeInTheDocument();
		expect(screen.queryByRole('navigation', { name: STORY_LABELS.storyList })).not.toBeInTheDocument();
		expect(screen.queryByRole('complementary', { name: STORY_LABELS.sceneDetails })).not.toBeInTheDocument();

		fireEvent.keyDown(book, { key: 'ArrowRight' });
		expect(actions.setReaderPage).toHaveBeenLastCalledWith(1);
		expect(within(reader).getByRole('heading', { level: 2, name: 'The storm' })).toBeInTheDocument();
		fireEvent.keyDown(book, { key: 'End' });
		expect(within(reader).getByRole('heading', { level: 2, name: 'Morning calm' })).toBeInTheDocument();
		expect(within(reader).getByText('No picture yet')).toBeInTheDocument();
		expect(within(reader).getByRole('button', { name: STORY_LABELS.nextPage })).toBeDisabled();

		fireEvent.keyDown(book, { key: 'Escape' });
		expect(actions.closeReader).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('region', { name: STORY_LABELS.scenes })).toBeInTheDocument();
	});
});
