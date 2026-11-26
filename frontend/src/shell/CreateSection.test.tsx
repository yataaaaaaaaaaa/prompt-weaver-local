import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_REGION_IDS, CREATE_REGION_LABELS, F6_REGION_ATTRIBUTE } from '../app/sections';
import { COLLAPSED_REGION_WIDTH, REGION_MIN_WIDTH } from '../domain/layout';
import { useLayoutStore } from '../stores/layoutStore';
import { renderWithProviders } from '../test/render';
import { SPLITTER_STEP } from '../ui/Splitter';
import { CreateSection, LAYOUT_TOOLBAR_LABEL } from './CreateSection';

// The region contents have their own tests (other areas): stubs that say which one is drawn.
vi.mock('../features/categories/PromptBoard', () => ({ PromptBoard: () => <p>Board content</p> }));
vi.mock('../features/outputs/OutputViewer', () => ({ OutputViewer: () => <p>Viewer content</p> }));
vi.mock('../features/generation/GenerationPanel', () => ({
	GenerationPanel: () => <p>Generation content</p>,
	GenerationActionsCompact: () => <button type="button">Generate</button>,
}));
vi.mock('../features/generation/CreateCommandBar', () => ({ CreateCommandBar: () => <div role="toolbar" aria-label="Generation inputs" /> }));

/** The measured width of the regions row (jsdom does no layout). */
const ROW_WIDTH = 1600;

beforeEach(() => {
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		bottom: 900,
		right: ROW_WIDTH,
		width: ROW_WIDTH,
		height: 900,
		toJSON: () => ({}),
	});
});

const region = (id: (typeof CREATE_REGION_IDS)[number]) => screen.getByRole('region', { name: CREATE_REGION_LABELS[id] });
const layoutToolbar = () => screen.getByRole('toolbar', { name: LAYOUT_TOOLBAR_LABEL });
const toggle = (id: (typeof CREATE_REGION_IDS)[number]) => within(layoutToolbar()).getByRole('button', { name: CREATE_REGION_LABELS[id] });
const layout = () => useLayoutStore.getState();

describe('CreateSection', () => {
	it('docks the three regions, named and F6-cycled, after the command bar and the layout toolbar', () => {
		renderWithProviders(<CreateSection />);

		for (const id of CREATE_REGION_IDS) {
			expect(region(id)).toHaveAttribute(F6_REGION_ATTRIBUTE, id);
			expect(region(id)).toHaveAttribute('tabindex', '-1');
		}
		expect(within(region('board')).getByText('Board content')).toBeVisible();
		expect(within(region('viewer')).getByText('Viewer content')).toBeVisible();
		expect(within(region('generation')).getByText('Generation content')).toBeVisible();
		const header = screen.getByRole('toolbar', { name: 'Generation inputs' }).closest(`[${F6_REGION_ATTRIBUTE}]`);
		expect(header).toHaveAttribute(F6_REGION_ATTRIBUTE, 'commands');
		expect(header).toContainElement(layoutToolbar());
	});

	it('fits the stored widths into the measured row: the board takes the rest', () => {
		useLayoutStore.setState({ widths: { viewer: 600, generation: 400 } });
		renderWithProviders(<CreateSection />);

		expect(region('viewer')).toHaveStyle({ width: '600px' });
		expect(region('generation')).toHaveStyle({ width: '400px' });
		expect(region('board')).toHaveStyle({ width: `${ROW_WIDTH - 1000}px` });
	});

	it('has one pressed toggle per expanded region; a toggle collapses its region into a strip', async () => {
		const { user } = renderWithProviders(<CreateSection />);
		for (const id of CREATE_REGION_IDS) {
			expect(toggle(id)).toHaveAttribute('aria-pressed', 'true');
		}

		await user.click(toggle('viewer'));

		expect(layout().collapsed.viewer).toBe(true);
		expect(toggle('viewer')).toHaveAttribute('aria-pressed', 'false');
		expect(region('viewer')).toHaveAttribute('data-collapsed', 'true');
		expect(region('viewer')).toHaveStyle({ width: `${COLLAPSED_REGION_WIDTH}px` });
		expect(within(region('viewer')).queryByText('Viewer content')).not.toBeVisible();
		expect(within(region('viewer')).getByRole('button', { name: 'Expand Current image' })).toBeInTheDocument();
	});

	it('expands a strip with its Expand button and moves the focus into the region', async () => {
		layout().setRegionCollapsed('board', true);
		const { user } = renderWithProviders(<CreateSection />);

		await user.click(within(region('board')).getByRole('button', { name: 'Expand Prompt board' }));

		expect(layout().collapsed.board).toBe(false);
		expect(within(region('board')).getByText('Board content')).toBeVisible();
		expect(region('board')).toHaveFocus();
	});

	it('keeps the generation actions in the collapsed generation strip', () => {
		layout().setRegionCollapsed('generation', true);
		renderWithProviders(<CreateSection />);

		const strip = region('generation');
		expect(within(strip).getByRole('button', { name: 'Expand Generation' })).toBeInTheDocument();
		expect(within(strip).getByRole('button', { name: 'Generate' })).toBeVisible();
		expect(within(strip).queryByText('Generation content')).not.toBeVisible();
	});

	it('never collapses the last expanded region', async () => {
		useLayoutStore.setState({ collapsed: { board: false, viewer: true, generation: true } });
		const { user } = renderWithProviders(<CreateSection />);

		expect(toggle('board')).toHaveAttribute('aria-disabled', 'true');
		await user.click(toggle('board'));

		expect(layout().collapsed.board).toBe(false);
	});

	it('cycles the layout like Ctrl+H, with the shortcut in its description', async () => {
		const { user } = renderWithProviders(<CreateSection />);
		const cycle = within(layoutToolbar()).getByRole('button', { name: 'Cycle the Create layout' });
		expect(cycle).toHaveAttribute('aria-keyshortcuts', 'Control+H');

		await user.click(cycle);

		expect(layout().collapsed).toEqual({ board: false, viewer: true, generation: true });
	});

	it('resizes the viewer and the generation panel with splitters valued in px', () => {
		useLayoutStore.setState({ widths: { viewer: 600, generation: 400 } });
		renderWithProviders(<CreateSection />);

		const viewerSplitter = screen.getByRole('separator', { name: 'Resize Current image' });
		expect(viewerSplitter).toHaveAttribute('aria-controls', region('viewer').id);
		expect(viewerSplitter).toHaveAttribute('aria-valuenow', '600');
		expect(viewerSplitter).toHaveAttribute('aria-valuemin', String(REGION_MIN_WIDTH.viewer));
		expect(viewerSplitter).toHaveAttribute('aria-valuemax', String(600 + ROW_WIDTH - 1000 - REGION_MIN_WIDTH.board));

		fireEvent.keyDown(viewerSplitter, { key: 'ArrowLeft' });
		expect(layout().widths.viewer).toBe(600 + SPLITTER_STEP);

		const generationSplitter = screen.getByRole('separator', { name: 'Resize Generation' });
		expect(generationSplitter).toHaveAttribute('aria-controls', region('generation').id);
		fireEvent.keyDown(generationSplitter, { key: 'Home' });
		expect(layout().widths.generation).toBe(REGION_MIN_WIDTH.generation);
	});

	it('draws a dragged width live and stores it on release', () => {
		useLayoutStore.setState({ widths: { viewer: 600, generation: 400 } });
		renderWithProviders(<CreateSection />);
		const splitter = screen.getByRole('separator', { name: 'Resize Current image' });

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 800 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 700 });

		expect(region('viewer')).toHaveStyle({ width: '700px' });
		expect(layout().widths.viewer).toBe(600);

		fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 700 });

		expect(layout().widths.viewer).toBe(700);
		expect(region('viewer')).toHaveStyle({ width: '700px' });
	});

	it('collapses a region with Enter on its splitter and puts the focus on its Expand button', () => {
		renderWithProviders(<CreateSection />);
		const splitter = screen.getByRole('separator', { name: 'Resize Generation' });
		splitter.focus();

		fireEvent.keyDown(splitter, { key: 'Enter' });

		expect(layout().collapsed.generation).toBe(true);
		expect(screen.queryByRole('separator', { name: 'Resize Generation' })).not.toBeInTheDocument();
		expect(within(region('generation')).getByRole('button', { name: 'Expand Generation' })).toHaveFocus();
	});

	it('has no splitter for a region that fills the row or is collapsed', () => {
		useLayoutStore.setState({ collapsed: { board: true, viewer: false, generation: false } });
		renderWithProviders(<CreateSection />);

		expect(screen.queryByRole('separator', { name: 'Resize Current image' })).not.toBeInTheDocument();
		expect(screen.getByRole('separator', { name: 'Resize Generation' })).toBeInTheDocument();

		act(() => layout().setRegionCollapsed('generation', true));

		expect(screen.queryAllByRole('separator', { name: /^Resize / })).toHaveLength(0);
	});
});
