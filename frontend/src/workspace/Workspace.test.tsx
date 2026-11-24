import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryKeyOf, type Category } from '../domain/categories';
import { categoryWindowKey } from '../domain/layout';
import { useCategoriesStore } from '../stores/categoriesStore';
import { useUndoStore } from '../stores/undoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { renderWithProviders } from '../test/render';
import { categoryDefaultLayout, Workspace } from './Workspace';

// Registered panes and category cards have their own tests: the shell only places them.
vi.mock('./paneRegistry', async () => {
	const { AddRegular, DismissRegular } = await import('@fluentui/react-icons');
	return {
		PANES: [
			{ id: 'alpha', title: 'Alpha', icon: AddRegular, defaultLayout: { x: 10, y: 20, width: 300, height: 200 }, component: () => <p>Alpha content</p> },
			{ id: 'beta', title: 'Beta', icon: DismissRegular, defaultLayout: { x: 400, y: 20, width: 300, height: 200 }, component: () => <p>Beta content</p> },
		],
	};
});
vi.mock('../features/categories/CategoryCard', () => ({
	CategoryCard: ({ categoryKey }: { categoryKey: string }) => <p>{`Card ${categoryKey}`}</p>,
}));

function category(text: string): Category {
	return { text, activation_text: '', priority: 1, state: 'normal', subPrompts: [] };
}

function stubActions() {
	const categories = { addCategory: vi.fn(() => 'new-category'), reorganize: vi.fn() };
	const workspace = { setPaneVisible: vi.fn(), cycleVisibilityMode: vi.fn(), focusWindow: vi.fn() };
	const undo = { undo: vi.fn(async () => undefined) };
	useCategoriesStore.setState(categories);
	useWorkspaceStore.setState(workspace);
	useUndoStore.setState(undo);
	return { ...categories, ...workspace, ...undo };
}

const windowsArea = () => screen.getByRole('main', { name: 'Workspace windows' });
const toolbar = () => screen.getByRole('toolbar', { name: 'Workspace' });

let actions: ReturnType<typeof stubActions>;

beforeEach(() => {
	actions = stubActions();
	useCategoriesStore.setState({ categories: [category('Hair'), category('Eye color')] });
});

describe('Workspace windows', () => {
	it('renders one window per category and one per visible registered pane', () => {
		renderWithProviders(<Workspace />);
		const area = windowsArea();

		expect(within(area).getByRole('region', { name: 'Hair category' })).toHaveTextContent(`Card ${categoryKeyOf('Hair')}`);
		expect(within(area).getByRole('region', { name: 'Eye color category' })).toHaveTextContent(`Card ${categoryKeyOf('Eye color')}`);
		expect(within(area).getByRole('region', { name: 'Alpha' })).toHaveTextContent('Alpha content');
		expect(within(area).getByRole('region', { name: 'Beta' })).toHaveTextContent('Beta content');
	});

	it('cascades category windows without a stored layout and uses stored layouts otherwise', () => {
		useWorkspaceStore.setState({ windows: { [categoryWindowKey(categoryKeyOf('Eye color'))]: { x: 900, y: 500, width: 320, height: 240, z: 4 } } });
		renderWithProviders(<Workspace />);

		const first = categoryDefaultLayout(0);
		expect(screen.getByRole('region', { name: 'Hair category' })).toHaveStyle({ left: `${first.x}px`, top: `${first.y}px` });
		expect(screen.getByRole('region', { name: 'Eye color category' })).toHaveStyle({ left: '900px', top: '500px', zIndex: '4' });
		expect(categoryDefaultLayout(1).x).toBeGreaterThan(first.x);
	});

	it('hides panes the user closed', () => {
		useWorkspaceStore.setState({ hiddenPaneIds: ['alpha'] });
		renderWithProviders(<Workspace />);
		expect(screen.queryByRole('region', { name: 'Alpha' })).not.toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Beta' })).toBeInTheDocument();
	});

	it('shows only categories or only panes depending on the visibility mode', () => {
		useWorkspaceStore.setState({ visibilityMode: 'categories-only' });
		const { unmount } = renderWithProviders(<Workspace />);
		expect(screen.getByRole('region', { name: 'Hair category' })).toBeInTheDocument();
		expect(screen.queryByRole('region', { name: 'Alpha' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Showing: Categories only/ })).toBeInTheDocument();
		unmount();

		useWorkspaceStore.setState({ visibilityMode: 'panes-only' });
		renderWithProviders(<Workspace />);
		expect(screen.queryByRole('region', { name: 'Hair category' })).not.toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Alpha' })).toBeInTheDocument();
	});

	it('closes a registered pane through the workspace store', async () => {
		const { user } = renderWithProviders(<Workspace />);
		await user.click(screen.getByRole('button', { name: 'Close Alpha' }));
		expect(actions.setPaneVisible).toHaveBeenCalledWith('alpha', false);
	});

	it('category windows cannot be closed (only deleted from the card)', () => {
		renderWithProviders(<Workspace />);
		expect(screen.queryByRole('button', { name: 'Close Hair category' })).not.toBeInTheDocument();
	});
});

describe('Workspace toolbar', () => {
	it('toggles pane visibility with one pressed toggle per registered pane', async () => {
		useWorkspaceStore.setState({ hiddenPaneIds: ['beta'] });
		const { user } = renderWithProviders(<Workspace />);
		const alpha = within(toolbar()).getByRole('button', { name: 'Alpha' });
		const beta = within(toolbar()).getByRole('button', { name: 'Beta' });

		expect(alpha).toHaveAttribute('aria-pressed', 'true');
		expect(beta).toHaveAttribute('aria-pressed', 'false');

		await user.click(alpha);
		expect(actions.setPaneVisible).toHaveBeenLastCalledWith('alpha', false);
		await user.click(beta);
		expect(actions.setPaneVisible).toHaveBeenLastCalledWith('beta', true);
	});

	it('adds and reorganizes categories', async () => {
		const { user } = renderWithProviders(<Workspace />);
		await user.click(within(toolbar()).getByRole('button', { name: 'Add category' }));
		await user.click(within(toolbar()).getByRole('button', { name: 'Reorganize categories' }));

		expect(actions.addCategory).toHaveBeenCalledTimes(1);
		expect(actions.reorganize).toHaveBeenCalledTimes(1);
		expect(within(toolbar()).getByRole('button', { name: 'Reorganize categories' })).toHaveAttribute('aria-keyshortcuts', 'Control+O');
	});

	it('cycles the visibility mode and shows the current one', async () => {
		const { user } = renderWithProviders(<Workspace />);
		const button = within(toolbar()).getByRole('button', { name: 'Showing: All windows' });
		expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+H');

		await user.click(button);
		expect(actions.cycleVisibilityMode).toHaveBeenCalledTimes(1);
	});

	it('enables Undo only when there is something to undo', async () => {
		const { user, unmount } = renderWithProviders(<Workspace />);
		expect(within(toolbar()).getByRole('button', { name: 'Undo' })).toBeDisabled();
		unmount();

		useUndoStore.setState({ entries: [{ type: 'delete-output', outputId: '0000000001' }] });
		renderWithProviders(<Workspace />);
		const undo = within(toolbar()).getByRole('button', { name: 'Undo' });
		expect(undo).toBeEnabled();
		await user.click(undo);
		expect(actions.undo).toHaveBeenCalledTimes(1);
	});
});
