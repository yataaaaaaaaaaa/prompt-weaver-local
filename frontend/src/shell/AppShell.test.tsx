import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { F6_REGION_ATTRIBUTE, SECTION_SEARCH_ATTRIBUTE, SHELL_LABELS } from '../app/sections';
import { useNavigationStore } from '../stores/navigationStore';
import { renderWithProviders } from '../test/render';
import { AppShell } from './AppShell';

// Each section stub renders two F6 regions and a search box, like the real sections (whose own tests cover them).
vi.mock('./CreateSection', () => ({
	CreateSection: () => (
		<>
			<div {...{ [F6_REGION_ATTRIBUTE]: 'commands' }} tabIndex={-1} data-testid="create-commands" />
			<section {...{ [F6_REGION_ATTRIBUTE]: 'board' }} tabIndex={-1} data-testid="create-board">
				<input aria-label="Search categories" {...{ [SECTION_SEARCH_ATTRIBUTE]: '' }} />
			</section>
		</>
	),
}));
vi.mock('../features/models/ModelsSection', () => ({
	ModelsSection: () => (
		<>
			<header {...{ [F6_REGION_ATTRIBUTE]: 'toolbar' }} tabIndex={-1} data-testid="models-toolbar">
				<input aria-label="Search models" {...{ [SECTION_SEARCH_ATTRIBUTE]: '' }} />
			</header>
			<section {...{ [F6_REGION_ATTRIBUTE]: 'results' }} tabIndex={-1} data-testid="models-results" />
		</>
	),
}));
vi.mock('../features/images/ImagesSection', () => ({ ImagesSection: () => <p>Images view</p> }));
vi.mock('../features/characters/CharactersSection', () => ({ CharactersSection: () => <p>Characters view</p> }));

const navigation = () => useNavigationStore.getState();
const focusedRegion = () => document.activeElement?.getAttribute(F6_REGION_ATTRIBUTE) ?? document.activeElement?.tagName;

describe('AppShell', () => {
	it('shows the rail and the Create section only, until another section is visited', () => {
		renderWithProviders(<AppShell />);

		expect(screen.getByRole('navigation', { name: SHELL_LABELS.navigation })).toBeInTheDocument();
		expect(screen.getByRole('main', { name: 'Create' })).toBeInTheDocument();
		expect(screen.queryAllByRole('main')).toHaveLength(1);
		expect(screen.queryByText('Images view')).not.toBeInTheDocument();
	});

	it('mounts a section on its first visit and keeps the others mounted, hidden', () => {
		renderWithProviders(<AppShell />);

		act(() => navigation().showSection('images'));

		expect(screen.getByRole('main', { name: 'Images' })).toBeVisible();
		expect(screen.queryByRole('main', { name: 'Create' })).not.toBeInTheDocument();
		const create = screen.getByTestId('create-board').closest('main');
		expect(create).toHaveAttribute('hidden');
		expect(create).toHaveAttribute('aria-label', 'Create');

		act(() => navigation().showSection('create'));

		expect(screen.getByText('Images view').closest('main')).toHaveAttribute('hidden');
		expect(screen.getByRole('main', { name: 'Create' })).toBeVisible();
	});

	it('cycles the focus through the regions on screen with F6 and Shift+F6, wrapping around', () => {
		renderWithProviders(<AppShell />);

		act(() => navigation().cycleRegion(1));
		expect(focusedRegion()).toBe('nav');
		act(() => navigation().cycleRegion(1));
		expect(focusedRegion()).toBe('commands');
		act(() => navigation().cycleRegion(1));
		expect(focusedRegion()).toBe('board');
		act(() => navigation().cycleRegion(1));
		expect(focusedRegion()).toBe('nav');
		act(() => navigation().cycleRegion(-1));
		expect(focusedRegion()).toBe('board');
	});

	it('skips the regions of hidden sections', () => {
		renderWithProviders(<AppShell />);
		act(() => navigation().showSection('models'));
		act(() => navigation().showSection('create'));
		screen.getByTestId('create-board').focus();

		act(() => navigation().cycleRegion(1));

		expect(focusedRegion()).toBe('nav');
	});

	it("focuses the shown section's search box with Ctrl+F", () => {
		renderWithProviders(<AppShell />);
		act(() => navigation().showSection('models'));

		act(() => navigation().focusSearch());

		expect(screen.getByRole('textbox', { name: 'Search models' })).toHaveFocus();
	});

	it('moves the focus to the first region of a section shown from the keyboard, and not for a rail click', async () => {
		const { user } = renderWithProviders(<AppShell />);

		act(() => navigation().showSection('models', { focus: true }));
		expect(screen.getByTestId('models-toolbar')).toHaveFocus();

		await user.click(screen.getByRole('button', { name: 'Create' }));
		expect(screen.getByRole('button', { name: 'Create' })).toHaveFocus();

		act(() => navigation().showSection('create', { focus: true }));
		expect(screen.getByTestId('create-commands')).toHaveFocus();
	});

	it('does not replay a focus request made before it mounted', () => {
		act(() => navigation().cycleRegion(1));
		act(() => navigation().focusSearch());

		renderWithProviders(<AppShell />);

		expect(document.activeElement).toBe(document.body);
	});
});
