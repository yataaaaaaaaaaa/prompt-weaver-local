// The prompt board (PromptBoard: toolbar, card grid, empty states, reorder by keyboard and pointer, live region) with
// the real stores, inside the app's real providers. jsdom does no layout: the pointer drag gets the geometry it reads
// from stubs; the e2e suite (e2e/categories/board.spec.ts) drags in the real browser.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import type { Category } from '../../domain/categories';
import { useBoardStore } from '../../stores/boardStore';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { renderWithProviders } from '../../test/render';
import { PromptBoard } from './PromptBoard';

const category = (text: string, extra: Partial<Category> = {}): Category => ({
	text,
	activation_text: '',
	priority: 1,
	state: 'normal',
	subPrompts: [{ text: `${text.toLowerCase()} prompt`, state: 'normal', extraLoraIds: [] }],
	...extra,
});

function seed(...categories: Category[]): void {
	useCategoriesStore.setState({ categories });
}

function renderBoard() {
	return renderWithProviders(<PromptBoard />);
}

function cardNames(): string[] {
	return screen.queryAllByRole('article').map((card) => card.getAttribute('aria-label')?.replace(/ category$/, '') ?? '');
}

function commands(): HTMLElement {
	return screen.getByRole('toolbar', { name: 'Board commands' });
}

function announcer(): HTMLElement {
	const element = document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
	if (!element) {
		throw new Error('no live region');
	}
	return element;
}

describe('board', () => {
	it('shows one card per category in board order, in a list', () => {
		seed(category('Alpha'), category('Beta'), category('Gamma'));
		useBoardStore.setState({ order: ['gamma', 'alpha'] });
		renderBoard();

		expect(within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('article')).toHaveLength(3);
		expect(cardNames()).toEqual(['Gamma', 'Alpha', 'Beta']);
		expect(screen.getByText('3 categories')).toBeInTheDocument();
	});

	it('has a toolbar with Add category, Collapse all, Expand all and Sort by priority (Ctrl+O)', () => {
		seed(category('Alpha'));
		renderBoard();

		for (const name of ['Add category', 'Collapse all', 'Expand all', 'Sort by priority']) {
			expect(within(commands()).getByRole('button', { name })).toBeInTheDocument();
		}
		expect(within(commands()).getByRole('button', { name: 'Sort by priority' })).toHaveAttribute('aria-keyshortcuts', 'Control+O');
		// Nothing is collapsed yet.
		expect(within(commands()).getByRole('button', { name: 'Expand all' })).toBeDisabled();
		const search = screen.getByRole('searchbox', { name: 'Search categories' });
		expect(search).toHaveAttribute(SECTION_SEARCH_ATTRIBUTE);
		expect(within(screen.getByRole('search', { name: 'Find categories' })).getByRole('combobox', { name: 'Filter by state' })).toHaveTextContent(
			'Any state',
		);
	});

	it('adds a category: its card comes last with its name editor open, the name selected', async () => {
		seed(category('Alpha'));
		const { user } = renderBoard();

		await user.click(within(commands()).getByRole('button', { name: 'Add category' }));

		expect(cardNames()).toEqual(['Alpha', 'new-category']);
		const editor = await screen.findByRole('textbox', { name: 'Category name' });
		await waitFor(() => expect(editor).toHaveFocus());
		await user.keyboard('Hair{Enter}');
		expect(cardNames()).toEqual(['Alpha', 'Hair']);
	});

	it('search: filters names, activation texts and sub-prompts; count, Clear filter, Escape clears', async () => {
		seed(category('Alpha'), category('Beta', { activation_text: 'girl' }), category('Gamma'));
		const { user } = renderBoard();
		const search = screen.getByRole('searchbox', { name: 'Search categories' });

		await user.type(search, 'girl');
		expect(cardNames()).toEqual(['Beta']);
		expect(screen.getByText('1 of 3 categories')).toBeInTheDocument();

		await user.clear(search);
		await user.type(search, 'gamma prompt');
		expect(cardNames()).toEqual(['Gamma']);
		await user.click(screen.getByRole('button', { name: 'Clear filter' }));
		expect(cardNames()).toEqual(['Alpha', 'Beta', 'Gamma']);
		expect(search).toHaveValue('');
		expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument();

		await user.type(search, 'alp{Escape}');
		expect(search).toHaveValue('');
		expect(cardNames()).toHaveLength(3);
	});

	it('state filter: shows the cards in that state', async () => {
		seed(category('Alpha'), category('Beta', { state: 'skip' }), category('Gamma', { subPrompts: [{ text: 'g', state: 'lock', extraLoraIds: [] }] }));
		const { user } = renderBoard();

		await user.click(screen.getByRole('combobox', { name: 'Filter by state' }));
		await user.click(await screen.findByRole('option', { name: 'Skipped' }));

		expect(useBoardStore.getState().filter.state).toBe('skipped');
		expect(cardNames()).toEqual(['Beta']);
		expect(screen.getByRole('combobox', { name: 'Filter by state' })).toHaveTextContent('Skipped');

		await user.click(screen.getByRole('combobox', { name: 'Filter by state' }));
		await user.click(await screen.findByRole('option', { name: 'With a locked sub-prompt' }));
		expect(cardNames()).toEqual(['Gamma']);
	});

	it('when nothing matches: a message and Clear filter', async () => {
		seed(category('Alpha'));
		useBoardStore.setState({ filter: { query: 'zzz', state: 'skipped' } });
		const { user } = renderBoard();

		expect(screen.getByRole('heading', { name: 'No category matches' })).toBeInTheDocument();
		expect(screen.getByText(/Nothing matches 'zzz', skipped\./)).toBeInTheDocument();
		expect(screen.getByText('0 of 1 category')).toBeInTheDocument();
		const clearButtons = screen.getAllByRole('button', { name: 'Clear filter' });
		await user.click(clearButtons[clearButtons.length - 1]);

		expect(cardNames()).toEqual(['Alpha']);
	});

	it('without categories: explains the board and offers to add one or browse images', async () => {
		seed();
		const { user } = renderBoard();

		expect(screen.getByRole('heading', { name: 'No categories yet' })).toBeInTheDocument();
		expect(screen.getByText('0 categories')).toBeInTheDocument();
		expect(within(commands()).getByRole('button', { name: 'Sort by priority' })).toBeDisabled();

		await user.click(screen.getByRole('button', { name: 'Browse images' }));
		expect(useNavigationStore.getState().section).toBe('images');

		act(() => useNavigationStore.getState().showSection('create'));
		await user.click(screen.getByRole('button', { name: 'Add your first category' }));
		expect(cardNames()).toEqual(['new-category']);
	});

	it('Collapse all / Expand all (persisted in the board store)', async () => {
		seed(category('Alpha'), category('Beta'));
		const { user } = renderBoard();

		await user.click(within(commands()).getByRole('button', { name: 'Collapse all' }));
		expect(useBoardStore.getState().collapsed).toEqual(['alpha', 'beta']);
		expect(screen.queryAllByRole('list', { name: 'Sub-prompts' })).toHaveLength(0);
		expect(within(commands()).getByRole('button', { name: 'Collapse all' })).toBeDisabled();

		await user.click(within(commands()).getByRole('button', { name: 'Expand all' }));
		expect(useBoardStore.getState().collapsed).toEqual([]);
		expect(screen.getAllByRole('list', { name: 'Sub-prompts' })).toHaveLength(2);
	});

	it('Sort by priority sorts the categories, makes it the board order and announces it', async () => {
		seed(category('Alpha', { priority: 3 }), category('Beta', { priority: 1 }), category('Gamma', { priority: 2 }));
		const { user } = renderBoard();

		await user.click(within(commands()).getByRole('button', { name: 'Sort by priority' }));

		expect(cardNames()).toEqual(['Beta', 'Gamma', 'Alpha']);
		expect(useBoardStore.getState().order).toEqual(['beta', 'gamma', 'alpha']);
		expect(announcer()).toHaveTextContent('Categories sorted by priority');
	});
});

describe('reorder with the keyboard', () => {
	it('arrows move to the neighbors, Home / End to the ends; announced, the focus stays on the handle', async () => {
		seed(category('Alpha'), category('Beta'), category('Gamma'));
		const { user } = renderBoard();

		screen.getByRole('button', { name: 'Reorder Alpha' }).focus();
		await user.keyboard('{ArrowRight}');
		expect(cardNames()).toEqual(['Beta', 'Alpha', 'Gamma']);
		expect(useBoardStore.getState().order).toEqual(['beta', 'alpha', 'gamma']);
		expect(announcer()).toHaveTextContent('Alpha moved to position 2 of 3');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveFocus());

		await user.keyboard('{End}');
		expect(cardNames()).toEqual(['Beta', 'Gamma', 'Alpha']);
		await user.keyboard('{ArrowDown}');
		expect(announcer()).toHaveTextContent('Alpha is at position 3 of 3');
		await user.keyboard('{Home}');
		expect(cardNames()).toEqual(['Alpha', 'Beta', 'Gamma']);
		await user.keyboard('{ArrowUp}{ArrowLeft}');
		expect(cardNames()).toEqual(['Alpha', 'Beta', 'Gamma']);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Reorder Alpha' })).toHaveFocus());
	});

	it('moves relative to the shown cards while a filter hides some', async () => {
		seed(category('Alpha'), category('Beet'), category('Gamma'), category('Delta'));
		useBoardStore.setState({ filter: { query: 'a', state: 'any' } });
		const { user } = renderBoard();
		expect(cardNames()).toEqual(['Alpha', 'Gamma', 'Delta']);

		screen.getByRole('button', { name: 'Reorder Delta' }).focus();
		await user.keyboard('{ArrowLeft}');

		expect(cardNames()).toEqual(['Alpha', 'Delta', 'Gamma']);
		expect(useBoardStore.getState().order).toEqual(['alpha', 'beet', 'delta', 'gamma']);
		expect(announcer()).toHaveTextContent('Delta moved to position 2 of 3');
	});

	it('ignores modified keys and other keys', async () => {
		seed(category('Alpha'), category('Beta'));
		const { user } = renderBoard();

		screen.getByRole('button', { name: 'Reorder Alpha' }).focus();
		await user.keyboard('{Control>}{ArrowRight}{/Control}{Enter}a');

		expect(cardNames()).toEqual(['Alpha', 'Beta']);
	});
});

describe('reorder with the pointer', () => {
	const original = document.elementFromPoint;
	afterEach(() => {
		document.elementFromPoint = original;
	});

	function rect(left: number, top: number, width: number, height: number): DOMRect {
		return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
	}

	/** Lays the cards out in one row of 300 px wide cards inside a 1000 x 800 board. */
	function layOut(): Map<string, HTMLElement> {
		const scroller = document.querySelector<HTMLElement>('[data-board-scroll]')!;
		scroller.getBoundingClientRect = () => rect(0, 0, 1000, 800);
		const items = new Map<string, HTMLElement>();
		document.querySelectorAll<HTMLElement>('[data-board-card]').forEach((item, index) => {
			item.getBoundingClientRect = () => rect(index * 320, 0, 300, 400);
			items.set(item.getAttribute('data-board-card')!, item);
		});
		document.elementFromPoint = (x: number) => [...items.values()].find((item) => x >= item.getBoundingClientRect().left && x <= item.getBoundingClientRect().right) ?? null;
		return items;
	}

	it('drags a card next to the card under the pointer, with an insertion indicator, and drops it there', async () => {
		seed(category('Alpha'), category('Beta'), category('Gamma'));
		renderBoard();
		const items = layOut();
		const handle = screen.getByRole('button', { name: 'Reorder Alpha' });

		fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 });
		// Under the threshold: no drag yet.
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 12, clientY: 10 });
		expect(items.get('alpha')!.className).toBe(items.get('beta')!.className);
		// Over the right half of Gamma (with a bottom-half y: the same placement in a single column).
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 900, clientY: 380 });
		await waitFor(() => expect(items.get('gamma')!.className).not.toBe(items.get('beta')!.className));
		expect(items.get('alpha')!.className).not.toBe(items.get('beta')!.className);

		fireEvent.pointerUp(window, { pointerId: 1, clientX: 900, clientY: 380 });

		expect(useBoardStore.getState().order).toEqual(['beta', 'gamma', 'alpha']);
		expect(cardNames()).toEqual(['Beta', 'Gamma', 'Alpha']);
		expect(announcer()).toHaveTextContent('Alpha moved to position 3 of 3');
	});

	it('Escape, a cancelled pointer or a release outside the board moves nothing', async () => {
		seed(category('Alpha'), category('Beta'));
		renderBoard();
		layOut();
		const handle = screen.getByRole('button', { name: 'Reorder Alpha' });

		fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 600, clientY: 10 });
		fireEvent.keyDown(window, { key: 'Escape' });
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 600, clientY: 10 });
		expect(useBoardStore.getState().order).toEqual([]);

		fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 2, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(window, { pointerId: 2, clientX: 600, clientY: 10 });
		fireEvent.pointerCancel(window, { pointerId: 2 });
		expect(useBoardStore.getState().order).toEqual([]);

		fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 3, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(window, { pointerId: 3, clientX: 600, clientY: 10 });
		fireEvent.pointerMove(window, { pointerId: 3, clientX: 600, clientY: 900 });
		fireEvent.pointerUp(window, { pointerId: 3, clientX: 600, clientY: 900 });
		expect(useBoardStore.getState().order).toEqual([]);
		expect(cardNames()).toEqual(['Alpha', 'Beta']);
	});

	it('a secondary button never starts a drag', () => {
		seed(category('Alpha'), category('Beta'));
		renderBoard();
		layOut();

		fireEvent.pointerDown(screen.getByRole('button', { name: 'Reorder Alpha' }), { button: 2, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 600, clientY: 10 });
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 600, clientY: 10 });

		expect(useBoardStore.getState().order).toEqual([]);
	});
});
