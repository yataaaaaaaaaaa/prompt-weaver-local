import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outputImageUrl } from '../../api/config';
import type { OutputRecord } from '../../api/types';
import { useCharactersStore } from '../../stores/charactersStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useCurrentOutputDetails, useOutputsStore, type CurrentOutputDetails } from '../../stores/outputsStore';
import { useUndoStore } from '../../stores/undoStore';
import { outputCharacter } from '../../test/characterData';
import { renderWithProviders } from '../../test/render';
import { hasActionIntent } from '../../test/stateClasses';
import { VIEWER_EMPTY_TEXTS } from './CurrentOutputImage';
import { OutputViewer } from './OutputViewer';
import { DETAILS_TAB_LABELS, VIEWER_LABELS } from './viewerLabels';

// Several user-event interactions with Fluent popovers and tooltips per test: slow on a busy machine.

// The details derivation (record + library names) is the outputs store's; this view only renders it.
vi.mock('../../stores/outputsStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/outputsStore')>();
	return { ...actual, useCurrentOutputDetails: vi.fn() };
});
// The Used sub-prompts tab content has its own tests (src/features/forbidden/UsedSelectionsPane.test.tsx).
vi.mock('../forbidden/UsedSelectionsPane', () => ({ UsedSelectionsPane: () => <div data-testid="used-sub-prompts" /> }));

const DETAILS: CurrentOutputDetails = {
	outputId: '0000000002',
	imageName: '0000000002.png',
	generatedAt: '2026-11-24T10:00:00Z',
	width: 832,
	height: 1216,
	steps: 28,
	guidanceScale: 5.5,
	seed: 123456,
	promptSeed: 77,
	modelName: 'Noobai v50',
	loras: [
		{ name: 'Detail tweaker', weight: 0.6 },
		{ name: 'Film grain', weight: -1.25 },
	],
	prompt: '1girl, red hair',
	negativePrompt: 'lowres',
	character: null,
	story: null,
};

const RECORD = { output_id: '0000000002', prompt: '1girl, red hair' } as OutputRecord;

function stubActions() {
	const actions = {
		select: vi.fn(async () => undefined),
		first: vi.fn(async () => undefined),
		previous: vi.fn(async () => undefined),
		next: vi.fn(async () => undefined),
		last: vi.fn(async () => undefined),
		deleteCurrent: vi.fn(async () => undefined),
		copyCurrentPrompt: vi.fn(async () => undefined),
	};
	useOutputsStore.setState(actions);
	return actions;
}

function show(ids: string[], currentId: string | null, record: OutputRecord | null = null) {
	useOutputsStore.setState({ ids, currentId, record });
}

const toolbar = () => screen.getByRole('toolbar', { name: VIEWER_LABELS.outputActions });
const button = (name: string) => within(toolbar()).getByRole('button', { name });

let actions: ReturnType<typeof stubActions>;

beforeEach(() => {
	actions = stubActions();
	vi.mocked(useCurrentOutputDetails).mockReturnValue(null);
});

describe('OutputViewer toolbar', () => {
	it('names every action and shows the output number and position', () => {
		show(['0000000001', '0000000002', '0000000003'], '0000000002', RECORD);
		renderWithProviders(<OutputViewer />);

		for (const name of ['First output', 'Previous output', 'Next output', 'Last output', 'Copy prompt', 'Create character', 'Add to story', 'Undo', 'Delete']) {
			expect(button(name)).toBeInTheDocument();
		}
		expect(button(VIEWER_LABELS.detailsToggle)).toHaveAttribute('aria-pressed', 'true');
		expect(within(toolbar()).getByText('#0000000002')).toBeInTheDocument();
		expect(within(toolbar()).getByText('2 / 3')).toBeInTheDocument();
	});

	it('enables only the moves that exist from the current output', () => {
		show(['0000000001', '0000000002', '0000000003'], '0000000003', RECORD);
		renderWithProviders(<OutputViewer />);

		expect(button('First output')).toBeEnabled();
		expect(button('Previous output')).toBeEnabled();
		expect(button('Next output')).toBeDisabled();
		expect(button('Last output')).toBeDisabled();
		expect(button('Delete')).toBeEnabled();
	});

	it('disables the output actions without outputs', () => {
		show([], null);
		renderWithProviders(<OutputViewer />);

		for (const name of ['First output', 'Previous output', 'Next output', 'Last output', 'Delete', 'Copy prompt', 'Create character', 'Add to story', 'Undo']) {
			expect(button(name)).toBeDisabled();
		}
		expect(within(toolbar()).getByText('— / 0')).toBeInTheDocument();
	});

	it('calls the outputs store actions', async () => {
		show(['0000000001', '0000000002', '0000000003'], '0000000002', RECORD);
		const { user } = renderWithProviders(<OutputViewer />);

		await user.click(button('First output'));
		await user.click(button('Previous output'));
		await user.click(button('Next output'));
		await user.click(button('Last output'));
		await user.click(button('Delete'));
		await user.click(button('Copy prompt'));

		expect(actions.first).toHaveBeenCalledTimes(1);
		expect(actions.previous).toHaveBeenCalledTimes(1);
		expect(actions.next).toHaveBeenCalledTimes(1);
		expect(actions.last).toHaveBeenCalledTimes(1);
		expect(actions.deleteCurrent).toHaveBeenCalledTimes(1);
		expect(actions.copyCurrentPrompt).toHaveBeenCalledTimes(1);
	});

	it('announces the arrow-key shortcuts and shows them in the tooltips', async () => {
		show(['0000000001', '0000000002'], '0000000002', RECORD);
		const { user } = renderWithProviders(<OutputViewer />);

		expect(button('Previous output')).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowUp');
		expect(button('Next output')).toHaveAttribute('aria-keyshortcuts', 'ArrowRight ArrowDown');
		await user.hover(button('Previous output'));
		expect(await screen.findByRole('tooltip')).toHaveTextContent('Previous output (← / ↑)');
	});

	it('shows Delete as the red danger action that moves the output to the trash', async () => {
		show(['0000000001'], '0000000001', RECORD);
		const { user } = renderWithProviders(<OutputViewer />);

		expect(hasActionIntent(button('Delete'), 'subtle', 'danger')).toBe(true);
		await user.hover(button('Delete'));
		expect(await screen.findByRole('tooltip')).toHaveTextContent('Move to the app trash (Undo restores it)');
	});

	it('undoes the latest step, disabled when there is nothing to undo', async () => {
		show(['0000000001'], '0000000001', RECORD);
		const undo = vi.fn(async () => undefined);
		useUndoStore.setState({ undo });
		const { user } = renderWithProviders(<OutputViewer />);
		expect(button('Undo')).toBeDisabled();
		expect(button('Undo')).toHaveAttribute('aria-keyshortcuts', 'Control+Z');

		act(() => useUndoStore.setState({ entries: [{ type: 'delete-output', outputId: '0000000002' }] }));
		await user.click(button('Undo'));

		expect(undo).toHaveBeenCalledTimes(1);
	});

	it('creates a character from the current output', async () => {
		const startCreateFromOutput = vi.fn();
		useCharactersStore.setState({ startCreateFromOutput });
		show(['0000000002'], '0000000002', RECORD);
		const { user } = renderWithProviders(<OutputViewer />);

		await user.click(button('Create character'));

		expect(startCreateFromOutput).toHaveBeenCalledTimes(1);
	});

	it('copies the prompt only when the output has one', () => {
		show(['0000000002'], '0000000002', { ...RECORD, prompt: '' });
		renderWithProviders(<OutputViewer />);

		expect(button('Copy prompt')).toBeDisabled();
	});
});

describe('OutputViewer picture', () => {
	it('shows the current output picture, fitted without distortion; the only picture of that name', () => {
		show(['0000000041', '0000000042'], '0000000042', RECORD);
		renderWithProviders(<OutputViewer />);

		const images = screen.getAllByRole('img', { name: 'Output 0000000042' });
		expect(images).toHaveLength(1);
		expect(images[0]).toHaveAttribute('src', outputImageUrl('0000000042'));
		expect(images[0].className).toMatch(/fui-Image/);
	});

	it('says there are no outputs yet and how to make one', () => {
		show([], null);
		renderWithProviders(<OutputViewer />);

		const status = screen.getAllByRole('status').find((element) => element.textContent?.includes(VIEWER_EMPTY_TEXTS.noOutputs.title));
		expect(status).toHaveTextContent('No outputs yet');
		expect(status).toHaveTextContent('Press Generate (Ctrl+G) in the Generation panel');
		expect(screen.queryByRole('img', { name: /^Output / })).not.toBeInTheDocument();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});

	it('says no output is selected when outputs exist', () => {
		show(['0000000001'], null);
		renderWithProviders(<OutputViewer />);

		expect(screen.getByText(VIEWER_EMPTY_TEXTS.noSelection.title)).toBeInTheDocument();
		expect(screen.getByText('Pick an output in the filmstrip below.')).toBeInTheDocument();
		expect(screen.getByText('Pick an output in the filmstrip to see how it was made.')).toBeInTheDocument();
	});

	it('replaces a picture that cannot be loaded with an explanation, and shows the next output again', () => {
		show(['0000000003', '0000000004'], '0000000004', RECORD);
		renderWithProviders(<OutputViewer />);

		fireEvent.error(screen.getByRole('img', { name: 'Output 0000000004' }));

		expect(screen.queryByRole('img', { name: 'Output 0000000004' })).not.toBeInTheDocument();
		expect(screen.getByText('The image of output #0000000004 could not be loaded.')).toBeInTheDocument();
		expect(screen.getByText('Its file may have been moved or deleted outside the app.')).toBeInTheDocument();

		act(() => useOutputsStore.setState({ currentId: '0000000003' }));
		expect(screen.getByRole('img', { name: 'Output 0000000003' })).toHaveAttribute('src', outputImageUrl('0000000003'));
	});
});

describe('OutputViewer details panel', () => {
	it('the Output details toggle opens and closes the panel (layout store)', async () => {
		show(['0000000002'], '0000000002', RECORD);
		const { user } = renderWithProviders(<OutputViewer />);
		const toggle = button(VIEWER_LABELS.detailsToggle);
		expect(screen.getByRole('tablist')).toBeInTheDocument();

		await user.click(toggle);

		expect(useLayoutStore.getState().details.open).toBe(false);
		expect(toggle).toHaveAttribute('aria-pressed', 'false');
		expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

		await user.click(toggle);
		expect(useLayoutStore.getState().details.open).toBe(true);
		expect(screen.getByRole('tablist')).toBeInTheDocument();
	});

	it('has the Details and Used sub-prompts tabs, the selected one from the layout store', async () => {
		show(['0000000002'], '0000000002', RECORD);
		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		const { user } = renderWithProviders(<OutputViewer />);

		const tabs = screen.getAllByRole('tab');
		expect(tabs).toHaveLength(2);
		expect(tabs[0]).toHaveAccessibleName(DETAILS_TAB_LABELS.details);
		expect(tabs[1]).toHaveAccessibleName(DETAILS_TAB_LABELS.used);
		expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
		const panel = screen.getByRole('tabpanel');
		expect(panel).toHaveAccessibleName('Details');
		expect(within(panel).getByLabelText('Output details')).toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: 'Used sub-prompts' }));

		expect(useLayoutStore.getState().details).toEqual({ open: true, tab: 'used' });
		expect(screen.getByRole('tab', { name: 'Used sub-prompts' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Used sub-prompts');
		expect(screen.getByTestId('used-sub-prompts')).toBeInTheDocument();
		expect(screen.queryByLabelText('Output details', { selector: 'dl' })).not.toBeInTheDocument();
	});

	it('opens on the tab the layout store remembers', () => {
		useLayoutStore.setState({ details: { open: true, tab: 'used' } });
		show(['0000000002'], '0000000002', RECORD);
		renderWithProviders(<OutputViewer />);

		expect(screen.getByRole('tab', { name: 'Used sub-prompts' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByTestId('used-sub-prompts')).toBeInTheDocument();
	});

	it('lists the metadata of the current output', () => {
		show(['0000000001', '0000000002', '0000000003'], '0000000002', RECORD);
		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		renderWithProviders(<OutputViewer />);

		const list = within(screen.getByLabelText('Output details', { selector: 'dl' }));
		const value = (term: string) => list.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent;
		expect(value('Output')).toBe('#0000000002');
		expect(value('Position')).toBe('2 / 3');
		expect(value('Image name')).toBe('0000000002.png');
		expect(value('Size')).toBe('832 × 1216');
		expect(value('Steps')).toBe('28');
		expect(value('CFG')).toBe('5.5');
		expect(value('Seed')).toBe('123456');
		expect(value('Prompt seed')).toBe('77');
		expect(value('Model')).toBe('Noobai v50');
		expect(value('Prompt')).toBe('1girl, red hair');
		expect(value('Negative prompt')).toBe('lowres');
		// One line per LoRA: a name and its weight never wrap apart from the next LoRA.
		const loras = within(list.getByText('LoRAs', { selector: 'dt' }).nextElementSibling as HTMLElement).getAllByRole('listitem');
		expect(loras.map((item) => item.textContent)).toEqual(['Detail tweaker (0.6)', 'Film grain (-1.25)']);
		// A long name is truncated, its weight never is.
		const name = within(loras[1]).getByText('Film grain');
		expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
		expect(getComputedStyle(within(loras[1]).getByText('(-1.25)')).flexShrink).toBe('0');
	});

	it('shows placeholders for missing optional values', () => {
		show(['0000000002'], '0000000002', RECORD);
		vi.mocked(useCurrentOutputDetails).mockReturnValue({ ...DETAILS, promptSeed: null, loras: [], prompt: '', negativePrompt: '' });
		renderWithProviders(<OutputViewer />);

		const list = within(screen.getByLabelText('Output details', { selector: 'dl' }));
		expect(list.getByText('Prompt seed').nextElementSibling).toHaveTextContent('—');
		expect(list.getByText('LoRAs').nextElementSibling).toHaveTextContent('None');
		expect(list.getByText('Negative prompt').nextElementSibling).toHaveTextContent('—');
	});

	it('shows a spinner while the record loads, and explains an empty history', () => {
		show(['0000000002'], '0000000002');
		useOutputsStore.setState({ loadingRecord: true });
		const { unmount } = renderWithProviders(<OutputViewer />);
		expect(screen.getByText('Loading output details…')).toBeInTheDocument();
		unmount();

		show([], null);
		useOutputsStore.setState({ loadingRecord: false });
		renderWithProviders(<OutputViewer />);
		expect(screen.getByText('No details yet')).toBeInTheDocument();
	});

	it("shows the output's character and how its references were used", () => {
		show(['0000000002'], '0000000002', RECORD);
		vi.mocked(useCurrentOutputDetails).mockReturnValue({ ...DETAILS, character: outputCharacter() });
		const { unmount } = renderWithProviders(<OutputViewer />);

		const list = within(screen.getByLabelText('Output details', { selector: 'dl' }));
		expect(list.getByText('Character').nextElementSibling).toHaveTextContent('Alice · references applied (strength 0.6, 1 image)');
		unmount();

		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		renderWithProviders(<OutputViewer />);
		expect(within(screen.getByLabelText('Output details', { selector: 'dl' })).queryByText('Character')).not.toBeInTheDocument();
	});

	it('shows the story scene an output was generated for', () => {
		show(['0000000002'], '0000000002', RECORD);
		vi.mocked(useCurrentOutputDetails).mockReturnValue({
			...DETAILS,
			story: { story_id: 'sty-000000000001', scene_id: 'scn-000000000001', story_title: 'The lighthouse', scene_title: 'The storm' },
		});
		const { unmount } = renderWithProviders(<OutputViewer />);

		const list = within(screen.getByLabelText('Output details', { selector: 'dl' }));
		expect(list.getByText('Story').nextElementSibling).toHaveTextContent('The lighthouse · The storm');
		unmount();

		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		renderWithProviders(<OutputViewer />);
		expect(within(screen.getByLabelText('Output details', { selector: 'dl' })).queryByText('Story')).not.toBeInTheDocument();
	});
});
