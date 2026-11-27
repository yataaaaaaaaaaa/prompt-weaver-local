import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OutputRecord } from '../../api/types';
import { useOutputsStore } from '../../stores/outputsStore';
import { useStoryStore } from '../../stores/storyStore';
import { renderWithProviders } from '../../test/render';
import { OTHER_STORY_ID, story, STORY_ID } from '../../test/storyData';
import { seedStoryActions } from '../../test/storyStores';
import { AddToStoryButton } from './AddToStoryButton';
import { Toolbar } from '@fluentui/react-components';

let actions: ReturnType<typeof seedStoryActions>;

beforeEach(() => {
	actions = seedStoryActions();
	useStoryStore.setState({ stories: [story(), story({ id: OTHER_STORY_ID, title: "Bram's quest" })] });
});

function renderButton() {
	return renderWithProviders(
		<Toolbar aria-label="Output actions">
			<AddToStoryButton />
		</Toolbar>,
	);
}

describe('AddToStoryButton', () => {
	it('lists New story and every story; picking one adds the output shown as a scene', async () => {
		useOutputsStore.setState({ record: { output_id: '0000000002' } as OutputRecord });
		const { user } = renderButton();

		await user.click(screen.getByRole('button', { name: 'Add to story' }));
		const menu = await screen.findByRole('menu');
		expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['New story', 'The lighthouse', "Bram's quest"]);
		await user.click(within(menu).getByRole('menuitem', { name: "Bram's quest" }));
		expect(actions.addSceneFromOutput).toHaveBeenCalledWith(OTHER_STORY_ID);

		await user.click(screen.getByRole('button', { name: 'Add to story' }));
		await user.click(await screen.findByRole('menuitem', { name: 'New story' }));
		expect(actions.addSceneFromOutput).toHaveBeenLastCalledWith(null);
		expect(actions.addSceneFromOutput).not.toHaveBeenCalledWith(STORY_ID);
	});

	it('is disabled while no output is shown', () => {
		useOutputsStore.setState({ record: null });
		renderButton();

		expect(screen.getByRole('button', { name: 'Add to story' })).toBeDisabled();
	});
});
