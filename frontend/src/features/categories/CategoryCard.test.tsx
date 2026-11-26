// One category card of the prompt board (CategoryCard: <article> frame + CategoryHeader with the reorder handle,
// collapse toggle, name, count, state icon and CategoryActions + body with the activation text and SubPromptRow rows),
// inside the app's real providers. The derived visual states are produced by the forbidden-rules store (tested there
// without rendering): here the views are tested against that contract.
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '../../domain/categories';
import { useBoardStore } from '../../stores/boardStore';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCategoryCardState, useSubPromptVisualState } from '../../stores/forbiddenRulesStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useCurrentSelectionKey, useIsSubPromptInCurrentOutput } from '../../stores/outputsStore';
import { openDialog, waitForDialogClose } from '../../test/dialogs';
import { renderWithProviders } from '../../test/render';
import { hasClasses, stateClasses } from '../../test/stateClasses';
import { OWNS_KEYS_ATTRIBUTE } from '../../app/commands';
import { STATE_COLORS, VISUAL_STATES, type VisualState } from '../../ui/stateColors';
import { CategoryCard } from './CategoryCard';

vi.mock('../../stores/forbiddenRulesStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/forbiddenRulesStore')>();
	return { ...actual, useSubPromptVisualState: vi.fn(), useCategoryCardState: vi.fn() };
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

function renderCard(key = 'hair') {
	return renderWithProviders(<CategoryCard categoryKey={key} />);
}

function card(): HTMLElement {
	return screen.getByRole('article', { name: 'Hair category' });
}

function header(): HTMLElement {
	const element = card().querySelector(':scope > header');
	if (!(element instanceof HTMLElement)) {
		throw new Error('no card header');
	}
	return element;
}

function itemOf(text: string): HTMLElement {
	const item = screen
		.getAllByRole('list', { name: 'Sub-prompts' })
		.flatMap((list) => within(list).getAllByRole('listitem'))
		.find((element) => within(element).queryByRole('button', { name: `Sub-prompt: ${text}` }));
	if (!item) {
		throw new Error(`no row for ${text}`);
	}
	return item;
}

/** The row element (carries the state surface and data-visual-state). */
function rowOf(text: string): HTMLElement {
	return itemOf(text).firstElementChild as HTMLElement;
}

beforeEach(() => {
	vi.mocked(useSubPromptVisualState).mockReset().mockReturnValue(null);
	vi.mocked(useCategoryCardState).mockReset().mockReturnValue(null);
	vi.mocked(useIsSubPromptInCurrentOutput).mockReset().mockReturnValue(false);
	vi.mocked(useCurrentSelectionKey).mockReset().mockReturnValue(null);
});

describe('category card', () => {
	it('is an article named after the category: header with handle, toggle, name, count and commands; body with the texts', () => {
		seed();
		renderCard();

		const commands = within(header()).getByRole('group', { name: 'Category actions' });
		expect(within(commands).getByRole('textbox', { name: 'Priority' })).toHaveValue('2');
		for (const name of ['Edit all sub-prompts', 'Add sub-prompt', 'Skip category', 'Delete category']) {
			expect(within(commands).getByRole('button', { name })).toBeInTheDocument();
		}
		expect(within(header()).getByRole('button', { name: 'Reorder Hair' })).toHaveAttribute(OWNS_KEYS_ATTRIBUTE);
		expect(within(header()).getByRole('button', { name: 'Collapse Hair' })).toHaveAttribute('aria-expanded', 'true');
		expect(within(header()).getByRole('button', { name: 'Category name: Hair' })).toBeInTheDocument();
		expect(header()).toHaveTextContent('2 sub-prompts');
		expect(within(card()).getByRole('button', { name: 'Activation text: girl' })).toBeInTheDocument();
		const rows = within(within(card()).getByRole('list', { name: 'Sub-prompts' })).getAllByRole('listitem');
		expect(rows.map((row) => row.textContent)).toEqual(['red hair', 'blue hair']);
	});

	it('shows placeholders for an empty activation text and an empty sub-prompt; counts one sub-prompt', () => {
		seed({ ...HAIR, activation_text: '', subPrompts: [{ text: '', state: 'normal', extraLoraIds: [] }] });
		renderCard();

		expect(screen.getByRole('button', { name: 'Activation text: Activation text (optional)' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sub-prompt: Click to edit' })).toBeInTheDocument();
		expect(header()).toHaveTextContent('1 sub-prompt');
	});

	it.each(VISUAL_STATES.filter((state) => state !== 'current' && state !== 'locked'))('shows the card state %s on its frame', (state) => {
		seed();
		vi.mocked(useCategoryCardState).mockReturnValue(state);
		renderCard();
		const classes = stateClasses();

		expect(card()).toHaveAttribute('data-visual-state', state);
		expect(card()).toHaveAccessibleDescription(STATE_COLORS[state].label);
		expect(hasClasses(card(), classes.frame.card[state])).toBe(true);
		expect(hasClasses(header(), classes.frame.header[state])).toBe(true);
		const icon = within(header()).getByRole('img', { name: STATE_COLORS[state].label });
		expect(hasClasses(icon, classes.accent[state])).toBe(true);
		expect(vi.mocked(useCategoryCardState)).toHaveBeenCalledWith('hair');
	});

	it('a plain card has no state', () => {
		seed();
		renderCard();

		expect(card()).not.toHaveAttribute('data-visual-state');
		expect(card()).not.toHaveAttribute('aria-description');
		expect(within(header()).queryByRole('img')).not.toBeInTheDocument();
	});

	it('collapses to its header and expands again (board store)', async () => {
		seed();
		const { user } = renderCard();

		await user.click(screen.getByRole('button', { name: 'Collapse Hair' }));

		expect(useBoardStore.getState().collapsed).toEqual(['hair']);
		const expand = screen.getByRole('button', { name: 'Expand Hair' });
		expect(expand).toHaveAttribute('aria-expanded', 'false');
		expect(within(card()).queryByRole('list', { name: 'Sub-prompts' })).not.toBeInTheDocument();
		expect(within(card()).queryByRole('button', { name: /Activation text/ })).not.toBeInTheDocument();
		// The header keeps the name, the count, the priority and the commands.
		expect(within(header()).getByRole('button', { name: 'Category name: Hair' })).toBeInTheDocument();
		expect(within(header()).getByRole('textbox', { name: 'Priority' })).toBeInTheDocument();

		await user.click(expand);
		expect(useBoardStore.getState().collapsed).toEqual([]);
		const collapse = screen.getByRole('button', { name: 'Collapse Hair' });
		const body = document.getElementById(collapse.getAttribute('aria-controls') ?? '');
		expect(body).not.toBeNull();
		expect(within(body!).getByRole('list', { name: 'Sub-prompts' })).toBeInTheDocument();
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
		expect(within(card()).getByText("Separate sub-prompts with a line containing only '|'. Ctrl+Enter applies, Escape cancels.")).toBeInTheDocument();
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

	it('toggles skip on the category; the active Skip is the filled warning action', async () => {
		const actions = seed();
		const { user } = renderCard();
		const classes = stateClasses();
		const skip = screen.getByRole('button', { name: 'Skip category' });
		expect(skip).toHaveAttribute('aria-pressed', 'false');
		expect(hasClasses(skip, classes.actions.filled.warning)).toBe(false);

		await user.click(skip);
		expect(actions.setCategoryState).toHaveBeenCalledWith('hair', 'skip');

		act(() => {
			useCategoriesStore.setState({ categories: [{ ...HAIR, state: 'skip' }] });
		});
		expect(skip).toHaveAttribute('aria-pressed', 'true');
		expect(hasClasses(skip, classes.actions.filled.warning)).toBe(true);
		await user.click(skip);
		expect(actions.setCategoryState).toHaveBeenLastCalledWith('hair', 'normal');
	});

	it('deletes the category only after confirmation; Delete is the danger action', async () => {
		const actions = seed();
		const { user } = renderCard();
		const classes = stateClasses();
		expect(hasClasses(screen.getByRole('button', { name: 'Delete category' }), classes.actions.subtle.danger)).toBe(true);

		let dialog = await openDialog(user, screen.getByRole('button', { name: 'Delete category' }), 'alertdialog');
		expect(dialog).toHaveTextContent("Delete category 'Hair'?");
		expect(dialog).toHaveTextContent('Its sub-prompts and the forbidden rules naming it are deleted too.');
		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		await waitForDialogClose('alertdialog');
		expect(actions.removeCategory).not.toHaveBeenCalled();

		// The modal restores the page's aria-hidden asynchronously after the close: find the trigger again.
		dialog = await openDialog(user, await screen.findByRole('button', { name: 'Delete category' }), 'alertdialog');
		await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
		expect(actions.removeCategory).toHaveBeenCalledWith('hair');
	});

	it('an unknown category renders nothing', () => {
		seed();
		renderCard('missing');

		expect(screen.queryByRole('article')).not.toBeInTheDocument();
	});

	it('gives every icon-only button an accessible name', () => {
		seed();
		renderCard();

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
	});
});

describe('revealed card', () => {
	it('a new category opens its name editor with the name selected, then completes the request', async () => {
		seed({ ...HAIR, text: 'new-category' });
		useBoardStore.setState({ revealRequest: { key: 'new-category', serial: 4, editName: true }, lastRevealSerial: 4 });
		renderWithProviders(<CategoryCard categoryKey="new-category" />);

		const editor = await screen.findByRole('textbox', { name: 'Category name' });
		expect(editor).toHaveFocus();
		expect([(editor as HTMLTextAreaElement).selectionStart, (editor as HTMLTextAreaElement).selectionEnd]).toEqual([0, 'new-category'.length]);
		expect(useBoardStore.getState().revealRequest).toBeNull();
	});

	it('another reveal focuses the name, scrolled into view inside the board only', async () => {
		seed();
		renderWithProviders(
			<div data-board-scroll="" style={{ position: 'relative' }}>
				<CategoryCard categoryKey="hair" />
			</div>,
		);
		const scroller = card().parentElement as HTMLElement;
		Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
		Object.defineProperty(card(), 'offsetTop', { configurable: true, value: 900 });
		Object.defineProperty(card(), 'offsetHeight', { configurable: true, value: 200 });

		act(() => useBoardStore.getState().revealCategory('hair'));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Category name: Hair' })).toHaveFocus());
		expect(scroller.scrollTop).toBe(800);
		expect(useBoardStore.getState().revealRequest).toBeNull();
	});

	it('waits until the Create section is shown', async () => {
		seed();
		useNavigationStore.setState({ section: 'images' });
		renderCard();

		act(() => useBoardStore.getState().revealCategory('hair'));
		expect(useBoardStore.getState().revealRequest).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Category name: Hair' })).not.toHaveFocus();

		act(() => useNavigationStore.getState().showSection('create'));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Category name: Hair' })).toHaveFocus());
		expect(useBoardStore.getState().revealRequest).toBeNull();
	});
});

describe('sub-prompt rows', () => {
	it('toggles skip', async () => {
		const actions = seed();
		const { user } = renderCard();

		await user.click(within(rowOf('red hair')).getByRole('button', { name: 'Skip sub-prompt' }));

		expect(actions.setSubPromptState).toHaveBeenCalledWith('hair', 'red-hair', 'skip');
	});

	it('toggles the lock (aria-pressed reflects the stored state; the checked lock is purple)', async () => {
		const actions = seed();
		const { user } = renderCard();
		const classes = stateClasses();
		const lockRed = within(rowOf('red hair')).getByRole('button', { name: 'Lock sub-prompt' });
		const lockBlue = within(rowOf('blue hair')).getByRole('button', { name: 'Lock sub-prompt' });
		expect(lockRed).toHaveAttribute('aria-pressed', 'false');
		expect(lockBlue).toHaveAttribute('aria-pressed', 'true');
		expect(hasClasses(lockBlue, classes.accent.locked)).toBe(true);
		expect(hasClasses(lockRed, classes.accent.locked)).toBe(false);

		await user.click(lockRed);
		expect(actions.setSubPromptState).toHaveBeenLastCalledWith('hair', 'red-hair', 'lock');
		await user.click(lockBlue);
		expect(actions.setSubPromptState).toHaveBeenLastCalledWith('hair', 'blue-hair', 'normal');
	});

	it('unskips a skipped sub-prompt; the active Skip is the filled warning action', async () => {
		const actions = seed({ ...HAIR, subPrompts: [{ text: 'red hair', state: 'skip', extraLoraIds: [] }] });
		const { user } = renderCard();
		const classes = stateClasses();
		const skip = within(rowOf('red hair')).getByRole('button', { name: 'Skip sub-prompt' });
		expect(skip).toHaveAttribute('aria-pressed', 'true');
		expect(hasClasses(skip, classes.actions.filled.warning)).toBe(true);

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

	it('deletes; Delete is the subtle danger action', async () => {
		const actions = seed();
		const { user } = renderCard();
		const classes = stateClasses();
		const remove = within(rowOf('blue hair')).getByRole('button', { name: 'Delete sub-prompt' });
		expect(hasClasses(remove, classes.actions.subtle.danger)).toBe(true);

		await user.click(remove);

		expect(actions.removeSubPrompt).toHaveBeenCalledWith('hair', 'blue-hair');
	});

	const ICON_STATES: readonly VisualState[] = ['forbiddenLocked', 'forbidden', 'associated', 'current', 'indirectlyDisabled'];

	it.each(VISUAL_STATES)('shows the row state %s: attribute, surface, text style, description and icon', (state) => {
		seed();
		vi.mocked(useSubPromptVisualState).mockImplementation((_key, promptKey) => (promptKey === 'red-hair' ? state : null));
		renderCard();
		const classes = stateClasses();

		const row = rowOf('red hair');
		expect(row).toHaveAttribute('data-visual-state', state);
		expect(hasClasses(row, classes.surface[state])).toBe(true);
		const text = within(row).getByRole('button', { name: 'Sub-prompt: red hair' });
		expect(hasClasses(text, classes.text[state])).toBe(true);
		expect(text).toHaveAccessibleDescription(STATE_COLORS[state].label);
		const icon = row.querySelector(`[data-state-icon="${state}"]`);
		if (ICON_STATES.includes(state)) {
			expect(icon).not.toBeNull();
			expect(icon).toHaveAttribute('aria-hidden', 'true');
		} else {
			expect(icon).toBeNull();
		}

		const plain = rowOf('blue hair');
		expect(plain).not.toHaveAttribute('data-visual-state');
		expect(within(plain).getByRole('button', { name: 'Sub-prompt: blue hair' })).not.toHaveAccessibleDescription();
		expect(vi.mocked(useSubPromptVisualState)).toHaveBeenCalledWith('hair', 'red-hair');
	});

	it('marks the rows used by the current output (aria-current), whatever their visual state', () => {
		seed();
		vi.mocked(useIsSubPromptInCurrentOutput).mockImplementation((_key, promptKey) => promptKey === 'blue-hair');
		vi.mocked(useSubPromptVisualState).mockImplementation((_key, promptKey) => (promptKey === 'blue-hair' ? 'associated' : null));
		renderCard();

		expect(rowOf('blue hair')).toHaveAttribute('aria-current', 'true');
		expect(rowOf('red hair')).not.toHaveAttribute('aria-current');
	});
});
