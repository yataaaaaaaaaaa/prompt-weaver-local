import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, CategoryUiState, SubPromptUiState } from '../../domain/categories';
import { useCategoriesStore, useCategoryUiState, useSubPromptUiState } from '../../stores/categoriesStore';
import { useForbiddenHighlight } from '../../stores/forbiddenRulesStore';
import { useCurrentSelectionKey, useIsSubPromptInCurrentOutput } from '../../stores/outputsStore';
import { renderWithProviders } from '../../test/render';
import { CategoryCard } from './CategoryCard';

// Derived-state hooks are implemented by other stores' owners: the view is tested against their contract.
vi.mock('../../stores/categoriesStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/categoriesStore')>();
	return { ...actual, useCategoryUiState: vi.fn(), useSubPromptUiState: vi.fn() };
});
vi.mock('../../stores/forbiddenRulesStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/forbiddenRulesStore')>();
	return { ...actual, useForbiddenHighlight: vi.fn() };
});
vi.mock('../../stores/outputsStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/outputsStore')>();
	return { ...actual, useIsSubPromptInCurrentOutput: vi.fn(), useCurrentSelectionKey: vi.fn() };
});

const HAIR: Category = {
	text: 'Hair',
	activation_text: 'girl',
	priority: 2,
	state: 'normal',
	subPrompts: [
		{ text: 'red hair', state: 'normal', extraLoraIds: [] },
		{ text: 'blue hair', state: 'lock', extraLoraIds: [] },
	],
};

function seed(category: Category = HAIR) {
	const actions = {
		renameCategory: vi.fn(() => true),
		setActivationText: vi.fn(),
		setPriority: vi.fn(),
		setCategoryState: vi.fn(),
		addSubPrompt: vi.fn(),
		setSubPromptText: vi.fn(() => true),
		setSubPromptState: vi.fn(),
		removeSubPrompt: vi.fn(),
		applyBulkText: vi.fn(),
		removeCategory: vi.fn(),
	};
	useCategoriesStore.setState({ categories: [category], ...actions });
	return actions;
}

function renderCard() {
	return renderWithProviders(<CategoryCard categoryKey="hair" />);
}

function rowOf(text: string): HTMLElement {
	const item = screen.getAllByRole('listitem').find((element) => within(element).queryByRole('button', { name: `Sub-prompt: ${text}` }));
	if (!item) {
		throw new Error(`no row for ${text}`);
	}
	return item;
}

beforeEach(() => {
	vi.mocked(useCategoryUiState).mockReset().mockReturnValue('normal');
	vi.mocked(useSubPromptUiState).mockReset().mockReturnValue('normal');
	vi.mocked(useForbiddenHighlight).mockReset().mockReturnValue('none');
	vi.mocked(useIsSubPromptInCurrentOutput).mockReset().mockReturnValue(false);
	vi.mocked(useCurrentSelectionKey).mockReset().mockReturnValue(null);
});

describe('CategoryCard', () => {
	it('renders the name, activation text, priority and sub-prompts', () => {
		seed();
		renderCard();

		expect(screen.getByRole('button', { name: 'Category name: Hair' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Activation text: girl' })).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'Priority' })).toHaveValue('2');
		const rows = within(screen.getByRole('list', { name: 'Sub-prompts' })).getAllByRole('listitem');
		expect(rows.map((row) => row.textContent)).toEqual(['red hair', 'blue hair']);
	});

	it('shows placeholders for an empty activation text and an empty sub-prompt', () => {
		seed({ ...HAIR, activation_text: '', subPrompts: [{ text: '', state: 'normal', extraLoraIds: [] }] });
		renderCard();

		expect(screen.getByRole('button', { name: 'Activation text: Activation text (optional)' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sub-prompt: Click to edit' })).toBeInTheDocument();
	});

	it('renames on Enter', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Category name: Hair' }));
		const editor = screen.getByRole('textbox', { name: 'Category name' });
		expect(editor).toHaveFocus();
		expect(editor).toHaveValue('Hair');
		await user.type(editor, ' color{Enter}');

		expect(actions.renameCategory).toHaveBeenCalledWith('hair', 'Hair color');
		expect(screen.queryByRole('textbox', { name: 'Category name' })).not.toBeInTheDocument();
	});

	it('cancels a rename on Escape and returns focus to the name', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Category name: Hair' }));
		await user.type(screen.getByRole('textbox', { name: 'Category name' }), 'XYZ{Escape}');

		expect(actions.renameCategory).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Category name: Hair' })).toHaveFocus();
	});

	it('does not commit an unchanged name', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Category name: Hair' }));
		await user.keyboard('{Enter}');

		expect(actions.renameCategory).not.toHaveBeenCalled();
	});

	it('edits the activation text: Shift+Enter inserts a newline, blur commits', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Activation text: girl' }));
		await user.type(screen.getByRole('textbox', { name: 'Activation text' }), '{Shift>}{Enter}{/Shift}boy');
		expect(actions.setActivationText).not.toHaveBeenCalled();
		await user.click(document.body);

		expect(actions.setActivationText).toHaveBeenCalledTimes(1);
		expect(actions.setActivationText).toHaveBeenCalledWith('hair', 'girl\nboy');
	});

	it('starts editing from the keyboard', async () => {
		seed();
		const { user } = renderCard();

		screen.getByRole('button', { name: 'Category name: Hair' }).focus();
		await user.keyboard('{Enter}');

		expect(screen.getByRole('textbox', { name: 'Category name' })).toHaveFocus();
	});

	it('commits parseable priorities (decimals allowed) and ignores the rest', async () => {
		const actions = seed();
		const { user } = renderCard();
		const priority = screen.getByRole('textbox', { name: 'Priority' });

		await user.clear(priority);
		await user.type(priority, '1.5');
		expect(actions.setPriority).toHaveBeenLastCalledWith('hair', 1.5);
		expect(priority).toHaveValue('1.5');

		actions.setPriority.mockClear();
		await user.clear(priority);
		await user.type(priority, 'abc');
		expect(actions.setPriority).not.toHaveBeenCalled();
	});

	it('resyncs the priority draft when the store value changes', () => {
		seed();
		renderCard();

		act(() => {
			useCategoriesStore.setState({ categories: [{ ...HAIR, priority: 7 }] });
		});

		expect(screen.getByRole('textbox', { name: 'Priority' })).toHaveValue('7');
	});

	it('bulk edits all sub-prompts with Ctrl+Enter', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Edit all sub-prompts' }));
		const editor = screen.getByRole('textbox', { name: 'All sub-prompts' });
		expect(editor).toHaveFocus();
		expect(editor).toHaveValue('red hair\n|\nblue hair');
		await user.type(editor, '{Enter}|{Enter}green hair{Control>}{Enter}{/Control}');

		expect(actions.applyBulkText).toHaveBeenCalledTimes(1);
		expect(actions.applyBulkText).toHaveBeenCalledWith('hair', 'red hair\n|\nblue hair\n|\ngreen hair');
		expect(screen.queryByRole('textbox', { name: 'All sub-prompts' })).not.toBeInTheDocument();
		expect(screen.getByRole('list', { name: 'Sub-prompts' })).toBeInTheDocument();
	});

	it('cancels the bulk editor on Escape', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Edit all sub-prompts' }));
		await user.type(screen.getByRole('textbox', { name: 'All sub-prompts' }), 'garbage{Escape}');

		expect(actions.applyBulkText).not.toHaveBeenCalled();
		expect(screen.getByRole('list', { name: 'Sub-prompts' })).toBeInTheDocument();
	});

	it('applies the bulk editor on blur', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Edit all sub-prompts' }));
		await user.type(screen.getByRole('textbox', { name: 'All sub-prompts' }), '!');
		await user.click(document.body);

		expect(actions.applyBulkText).toHaveBeenCalledWith('hair', 'red hair\n|\nblue hair!');
	});

	it('adds a sub-prompt', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Add sub-prompt' }));

		expect(actions.addSubPrompt).toHaveBeenCalledWith('hair');
	});

	it('toggles skip on the category', async () => {
		const actions = seed();
		const { user } = renderCard();
		const skip = screen.getByRole('button', { name: 'Skip category' });
		expect(skip).toHaveAttribute('aria-pressed', 'false');

		await user.click(skip);
		expect(actions.setCategoryState).toHaveBeenCalledWith('hair', 'skip');

		act(() => {
			useCategoriesStore.setState({ categories: [{ ...HAIR, state: 'skip' }] });
		});
		expect(skip).toHaveAttribute('aria-pressed', 'true');
		await user.click(skip);
		expect(actions.setCategoryState).toHaveBeenLastCalledWith('hair', 'normal');
	});

	it('deletes the category only after confirmation', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Delete category' }));
		let dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent("Delete category 'Hair'?");
		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		expect(actions.removeCategory).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: 'Delete category' }));
		dialog = await screen.findByRole('alertdialog');
		await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
		expect(actions.removeCategory).toHaveBeenCalledWith('hair');
	});

	it.each<CategoryUiState>(['normal', 'skip', 'indirectly-disabled'])('reflects the category ui state %s', (state) => {
		seed();
		vi.mocked(useCategoryUiState).mockReturnValue(state);
		const { container } = renderCard();

		expect(container.querySelector('[data-ui-state]')).toHaveAttribute('data-ui-state', state);
	});

	it('renders nothing but an empty list for an unknown category', () => {
		seed();
		renderWithProviders(<CategoryCard categoryKey="missing" />);

		expect(screen.queryByRole('button', { name: /Category name/ })).not.toBeInTheDocument();
		expect(screen.queryAllByRole('listitem')).toHaveLength(0);
	});
});

describe('SubPromptRow (inside CategoryCard)', () => {
	it('toggles skip', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(within(rowOf('red hair')).getByRole('button', { name: 'Skip sub-prompt' }));

		expect(actions.setSubPromptState).toHaveBeenCalledWith('hair', 'red-hair', 'skip');
	});

	it('toggles the lock (aria-pressed reflects the stored state)', async () => {
		const actions = seed();
		const { user } = renderCard();
		const lockRed = within(rowOf('red hair')).getByRole('button', { name: 'Lock sub-prompt' });
		const lockBlue = within(rowOf('blue hair')).getByRole('button', { name: 'Lock sub-prompt' });
		expect(lockRed).toHaveAttribute('aria-pressed', 'false');
		expect(lockBlue).toHaveAttribute('aria-pressed', 'true');

		await user.click(lockRed);
		expect(actions.setSubPromptState).toHaveBeenLastCalledWith('hair', 'red-hair', 'lock');
		await user.click(lockBlue);
		expect(actions.setSubPromptState).toHaveBeenLastCalledWith('hair', 'blue-hair', 'normal');
	});

	it('unskips a skipped sub-prompt', async () => {
		const actions = seed({ ...HAIR, subPrompts: [{ text: 'red hair', state: 'skip', extraLoraIds: [] }] });
		const { user } = renderCard();
		const skip = within(rowOf('red hair')).getByRole('button', { name: 'Skip sub-prompt' });
		expect(skip).toHaveAttribute('aria-pressed', 'true');

		await user.click(skip);

		expect(actions.setSubPromptState).toHaveBeenCalledWith('hair', 'red-hair', 'normal');
	});

	it('edits the text (Enter commits, Escape cancels)', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Sub-prompt: red hair' }));
		await user.type(screen.getByRole('textbox', { name: 'Sub-prompt' }), ', long{Enter}');
		expect(actions.setSubPromptText).toHaveBeenCalledWith('hair', 'red-hair', 'red hair, long');

		await user.click(screen.getByRole('button', { name: 'Sub-prompt: blue hair' }));
		await user.type(screen.getByRole('textbox', { name: 'Sub-prompt' }), ' nope{Escape}');
		expect(actions.setSubPromptText).toHaveBeenCalledTimes(1);
	});

	it('deletes', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(within(rowOf('blue hair')).getByRole('button', { name: 'Delete sub-prompt' }));

		expect(actions.removeSubPrompt).toHaveBeenCalledWith('hair', 'blue-hair');
	});

	it('reflects highlights, the current output and ui states', () => {
		seed({
			...HAIR,
			subPrompts: [
				{ text: 'a', state: 'normal', extraLoraIds: [] },
				{ text: 'b', state: 'normal', extraLoraIds: [] },
				{ text: 'c', state: 'skip', extraLoraIds: [] },
				{ text: 'd', state: 'normal', extraLoraIds: [] },
			],
		});
		vi.mocked(useForbiddenHighlight).mockImplementation((_key, promptKey) =>
			promptKey === 'a' ? 'forbidden' : promptKey === 'b' ? 'forbidden-locked' : 'none',
		);
		vi.mocked(useIsSubPromptInCurrentOutput).mockImplementation((_key, promptKey) => promptKey === 'd');
		const uiStates: Record<string, SubPromptUiState> = { c: 'skip', d: 'indirectly-disabled' };
		vi.mocked(useSubPromptUiState).mockImplementation((_key, promptKey) => uiStates[promptKey] ?? 'normal');
		renderCard();

		const rowElement = (text: string) => rowOf(text).firstElementChild as HTMLElement;
		expect(rowElement('a')).toHaveAttribute('data-highlight', 'forbidden');
		expect(rowElement('b')).toHaveAttribute('data-highlight', 'forbidden-locked');
		expect(rowElement('c')).toHaveAttribute('data-highlight', 'none');
		expect(rowElement('c')).toHaveAttribute('data-ui-state', 'skip');
		expect(rowElement('d')).toHaveAttribute('data-ui-state', 'indirectly-disabled');
		expect(rowElement('d')).toHaveAttribute('aria-current', 'true');
		expect(rowElement('a')).not.toHaveAttribute('aria-current');
		expect(vi.mocked(useForbiddenHighlight)).toHaveBeenCalledWith('hair', 'a');
	});

	it('gives every icon-only button an accessible name', () => {
		seed();
		renderCard();

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
	});
});
