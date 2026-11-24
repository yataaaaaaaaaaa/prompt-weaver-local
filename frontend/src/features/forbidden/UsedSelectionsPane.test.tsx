import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssociationEndpoint } from '../../domain/forbiddenRules';
import { useForbiddenRulesStore, useUsedSelectionRows, type UsedSelectionRow } from '../../stores/forbiddenRulesStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { renderWithProviders } from '../../test/render';
import { UsedSelectionsPane } from './UsedSelectionsPane';

// Rows are derived by the forbidden-rules store (selections of the current output + rules + source).
vi.mock('../../stores/forbiddenRulesStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/forbiddenRulesStore')>();
	return { ...actual, useUsedSelectionRows: vi.fn() };
});

function endpoint(mode: AssociationEndpoint['mode'], categoryName: string, promptText: string, tagText: string | null = null): AssociationEndpoint {
	return { mode, categoryName, promptText, tagText };
}

function row(index: number, categoryName: string, promptText: string, tags: string[], flags: Partial<UsedSelectionRow> = {}): UsedSelectionRow {
	return {
		index,
		categoryName,
		promptText,
		locked: false,
		promptEndpoint: endpoint('prompt', categoryName, promptText),
		categoryEndpoint: endpoint('category', categoryName, promptText),
		isPromptSource: false,
		isCategorySource: false,
		isPromptForbidden: false,
		isCategoryForbidden: false,
		tags: tags.map((tagText) => ({ tagText, endpoint: endpoint('tag', categoryName, promptText, tagText), isSource: false, isForbidden: false })),
		...flags,
	};
}

const HAIR = row(0, 'Hair', 'red hair, long', ['red hair', 'long']);
const POSE = row(1, 'Pose', 'sitting', ['sitting']);

function seedActions() {
	const pickAssociationEndpoint = vi.fn();
	const copySelectionPrompt = vi.fn(async () => undefined);
	useForbiddenRulesStore.setState({ pickAssociationEndpoint });
	useOutputsStore.setState({ copySelectionPrompt });
	return { pickAssociationEndpoint, copySelectionPrompt };
}

function rowItem(name: string): HTMLElement {
	return screen.getByRole('listitem', { name });
}

beforeEach(() => {
	vi.mocked(useUsedSelectionRows).mockReset().mockReturnValue([]);
});

describe('UsedSelectionsPane', () => {
	it('shows the empty state, the legend and the initial hint', () => {
		seedActions();
		renderWithProviders(<UsedSelectionsPane />);

		expect(screen.getByText('No selected sub-prompts for the current image.')).toBeInTheDocument();
		expect(screen.getByText('P = sub-prompt association. C = category association. Click a tag chip for tag association.')).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('Pick P, C, or a tag on a row to select the source association target.');
	});

	it('renders one row per selection with its tags', () => {
		seedActions();
		vi.mocked(useUsedSelectionRows).mockReturnValue([HAIR, { ...POSE, locked: true }]);
		renderWithProviders(<UsedSelectionsPane />);

		const items = within(screen.getByRole('list', { name: 'Used sub-prompts' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		const hair = rowItem('Hair: red hair, long');
		expect(hair).toHaveTextContent('Hair');
		expect(within(within(hair).getByRole('group', { name: 'Tags' })).getAllByRole('button').map((button) => button.textContent)).toEqual([
			'red hair',
			'long',
		]);
		expect(within(rowItem('Pose: sitting')).getByText('Locked')).toBeInTheDocument();
		expect(screen.queryByText('No selected sub-prompts for the current image.')).not.toBeInTheDocument();
	});

	it('picks P, C and tag endpoints', async () => {
		const actions = seedActions();
		vi.mocked(useUsedSelectionRows).mockReturnValue([HAIR, POSE]);
		const { user } = renderWithProviders(<UsedSelectionsPane />);
		const hair = rowItem('Hair: red hair, long');
		const pose = rowItem('Pose: sitting');

		await user.click(within(hair).getByRole('button', { name: 'P: sub-prompt association' }));
		expect(actions.pickAssociationEndpoint).toHaveBeenLastCalledWith(HAIR.promptEndpoint);

		await user.click(within(pose).getByRole('button', { name: 'C: category association' }));
		expect(actions.pickAssociationEndpoint).toHaveBeenLastCalledWith(POSE.categoryEndpoint);

		await user.click(within(hair).getByRole('button', { name: 'long' }));
		expect(actions.pickAssociationEndpoint).toHaveBeenLastCalledWith(HAIR.tags[1].endpoint);
	});

	it('copies the prompt of a row by index', async () => {
		const actions = seedActions();
		vi.mocked(useUsedSelectionRows).mockReturnValue([HAIR, POSE]);
		const { user } = renderWithProviders(<UsedSelectionsPane />);

		await user.click(within(rowItem('Pose: sitting')).getByRole('button', { name: 'Copy sub-prompt' }));

		expect(actions.copySelectionPrompt).toHaveBeenCalledWith(1);
	});

	it('reflects the association source and forbidden endpoints', () => {
		seedActions();
		vi.mocked(useUsedSelectionRows).mockReturnValue([
			{ ...HAIR, isPromptSource: true },
			{
				...POSE,
				isPromptForbidden: true,
				isCategoryForbidden: true,
				tags: [{ ...POSE.tags[0], isForbidden: true }],
			},
			row(2, 'Light', 'soft light', ['soft light'], {
				isCategorySource: false,
				tags: [{ tagText: 'soft light', endpoint: endpoint('tag', 'Light', 'soft light', 'soft light'), isSource: true, isForbidden: false }],
			}),
		]);
		renderWithProviders(<UsedSelectionsPane />);

		const hair = rowItem('Hair: red hair, long');
		expect(within(hair).getByRole('button', { name: 'P: sub-prompt association' })).toHaveAttribute('aria-pressed', 'true');
		expect(within(hair).getByRole('button', { name: 'C: category association' })).toHaveAttribute('aria-pressed', 'false');

		const pose = rowItem('Pose: sitting');
		const poseP = within(pose).getByRole('button', { name: 'P: sub-prompt association' });
		expect(poseP).toHaveAttribute('aria-pressed', 'false');
		expect(poseP).toHaveAttribute('data-forbidden', 'true');
		expect(within(pose).getByRole('button', { name: 'C: category association' })).toHaveAttribute('data-forbidden', 'true');
		expect(within(pose).getByRole('button', { name: 'sitting' })).toHaveAttribute('data-forbidden', 'true');
		expect(within(hair).getByRole('button', { name: 'long' })).not.toHaveAttribute('data-forbidden');

		expect(within(rowItem('Light: soft light')).getByRole('button', { name: 'soft light' })).toHaveAttribute('aria-pressed', 'true');
	});

	it.each([
		[endpoint('prompt', 'Hair', 'red hair'), 'sub-prompt'],
		[endpoint('category', 'Hair', 'red hair'), 'category'],
		[endpoint('tag', 'Hair', 'red hair, long', 'long'), "tag 'long'"],
	])('describes the selected source (%#)', (source, description) => {
		seedActions();
		renderWithProviders(<UsedSelectionsPane />);

		act(() => {
			useForbiddenRulesStore.setState({ associationSource: source });
		});

		expect(screen.getByRole('status')).toHaveTextContent(
			`Source selected: ${description}. Choose P, C, or a tag on another row to create or disable the association.`,
		);
	});

	it('names every button', () => {
		seedActions();
		vi.mocked(useUsedSelectionRows).mockReturnValue([HAIR, POSE]);
		renderWithProviders(<UsedSelectionsPane />);

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
	});
});
