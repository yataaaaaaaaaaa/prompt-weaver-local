import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outputThumbnailUrl } from '../../api/config';
import { FILMSTRIP_RADIUS, formatOutputId, nextOutputId, previousOutputId } from '../../domain/outputs';
import { useOutputsStore } from '../../stores/outputsStore';
import { renderWithProviders } from '../../test/render';
import { hasClasses, stateClasses } from '../../test/stateClasses';
import { Filmstrip } from './Filmstrip';
import { VIEWER_LABELS } from './viewerLabels';

// Several user-event interactions with Fluent popovers and tooltips per test: slow on a busy machine.

const ids = (count: number) => Array.from({ length: count }, (_, index) => formatOutputId(index + 1));

/** Navigation actions that move the current output like the store does (recorded by vi.fn). */
function stubNavigation() {
	const move = (find: (all: readonly string[], current: string | null) => string | null) => async () => {
		const { ids: all, currentId } = useOutputsStore.getState();
		const target = find(all, currentId);
		if (target !== null) {
			useOutputsStore.setState({ currentId: target });
		}
	};
	const actions = {
		select: vi.fn(async (outputId: string | null) => {
			useOutputsStore.setState({ currentId: outputId });
		}),
		previous: vi.fn(move(previousOutputId)),
		next: vi.fn(move(nextOutputId)),
		first: vi.fn(move((all) => all[0] ?? null)),
		last: vi.fn(move((all) => all[all.length - 1] ?? null)),
	};
	useOutputsStore.setState(actions);
	return actions;
}

const listbox = () => screen.getByRole('listbox', { name: VIEWER_LABELS.filmstrip });
const option = (outputId: string) => within(listbox()).getByRole('option', { name: `Output ${outputId}` });

let actions: ReturnType<typeof stubNavigation>;

beforeEach(() => {
	actions = stubNavigation();
});

describe('Filmstrip', () => {
	it('is a horizontal listbox of named options with lazy thumbnails that never take the picture name', () => {
		useOutputsStore.setState({ ids: ids(4), currentId: formatOutputId(3) });
		renderWithProviders(<Filmstrip />);

		expect(listbox()).toHaveAttribute('aria-orientation', 'horizontal');
		const options = within(listbox()).getAllByRole('option');
		expect(options.map((item) => item.getAttribute('aria-label'))).toEqual(ids(4).map((outputId) => `Output ${outputId}`));
		expect(option(formatOutputId(3))).toHaveAttribute('aria-selected', 'true');
		expect(options.filter((item) => item.getAttribute('aria-selected') === 'true')).toHaveLength(1);
		const thumbnail = option(formatOutputId(2)).querySelector('img');
		expect(thumbnail).toHaveAttribute('src', outputThumbnailUrl(formatOutputId(2)));
		expect(thumbnail).toHaveAttribute('alt', '');
		expect(thumbnail).toHaveAttribute('loading', 'lazy');
		expect(screen.queryByRole('img', { name: /^Output / })).not.toBeInTheDocument();
	});

	it('marks the current thumbnail with the current frame of the state styles', () => {
		useOutputsStore.setState({ ids: ids(3), currentId: formatOutputId(2) });
		renderWithProviders(<Filmstrip />);

		const current = stateClasses().frame.card.current;
		expect(hasClasses(option(formatOutputId(2)), current)).toBe(true);
		expect(hasClasses(option(formatOutputId(1)), current)).toBe(false);
	});

	it('renders a window around the current output, never the whole history', () => {
		useOutputsStore.setState({ ids: ids(2000), currentId: formatOutputId(1000) });
		renderWithProviders(<Filmstrip />);

		const options = within(listbox()).getAllByRole('option');
		expect(options).toHaveLength(2 * FILMSTRIP_RADIUS + 1);
		expect(options[FILMSTRIP_RADIUS]).toHaveAttribute('aria-selected', 'true');
	});

	it('selects an output on click', async () => {
		useOutputsStore.setState({ ids: ids(4), currentId: formatOutputId(4) });
		const { user } = renderWithProviders(<Filmstrip />);

		await user.click(option(formatOutputId(2)));

		expect(actions.select).toHaveBeenCalledWith(formatOutputId(2));
		expect(option(formatOutputId(2))).toHaveAttribute('aria-selected', 'true');
	});

	it('moves with the arrow keys, Home and End inside the listbox; the focus follows the current output', async () => {
		useOutputsStore.setState({ ids: ids(5), currentId: formatOutputId(3) });
		const { user } = renderWithProviders(<Filmstrip />);
		// Roving tabindex: only the current option is in the tab order.
		expect(within(listbox()).getAllByRole('option').filter((item) => item.tabIndex === 0)).toEqual([option(formatOutputId(3))]);

		await user.tab();
		expect(option(formatOutputId(3))).toHaveFocus();
		await user.keyboard('{ArrowLeft}');
		expect(actions.previous).toHaveBeenCalledTimes(1);
		expect(option(formatOutputId(2))).toHaveFocus();
		expect(option(formatOutputId(2))).toHaveAttribute('tabindex', '0');
		await user.keyboard('{ArrowRight}{ArrowRight}');
		expect(option(formatOutputId(4))).toHaveFocus();
		await user.keyboard('{Home}');
		expect(actions.first).toHaveBeenCalledTimes(1);
		expect(option(formatOutputId(1))).toHaveFocus();
		await user.keyboard('{End}');
		expect(actions.last).toHaveBeenCalledTimes(1);
		expect(option(formatOutputId(5))).toHaveFocus();
		await user.keyboard('{ArrowUp}');
		expect(option(formatOutputId(4))).toHaveFocus();
		await user.keyboard('{ArrowDown}');
		expect(option(formatOutputId(5))).toHaveFocus();
	});

	it('leaves modified keys to the app shortcuts', () => {
		useOutputsStore.setState({ ids: ids(3), currentId: formatOutputId(2) });
		renderWithProviders(<Filmstrip />);

		fireEvent.keyDown(option(formatOutputId(2)), { key: 'ArrowLeft', ctrlKey: true });

		expect(actions.previous).not.toHaveBeenCalled();
	});

	it('offers Jump to latest while an older output is shown', async () => {
		useOutputsStore.setState({ ids: ids(4), currentId: formatOutputId(2) });
		const { user } = renderWithProviders(<Filmstrip />);

		await user.click(screen.getByRole('button', { name: 'Jump to latest' }));

		expect(actions.last).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
		act(() => useOutputsStore.setState({ currentId: null }));
		expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
	});

	it('puts the latest thumbnail in the tab order when no output is shown', () => {
		useOutputsStore.setState({ ids: ids(3), currentId: null });
		renderWithProviders(<Filmstrip />);

		expect(option(formatOutputId(3))).toHaveAttribute('tabindex', '0');
		expect(within(listbox()).queryAllByRole('option', { selected: true })).toHaveLength(0);
	});

	it('replaces a thumbnail that cannot be loaded by an icon', () => {
		useOutputsStore.setState({ ids: ids(2), currentId: formatOutputId(2) });
		renderWithProviders(<Filmstrip />);

		fireEvent.error(option(formatOutputId(1)).querySelector('img') as HTMLImageElement);

		expect(option(formatOutputId(1)).querySelector('img')).toBeNull();
		expect(option(formatOutputId(1)).querySelector('svg')).not.toBeNull();
	});

	it('renders nothing without outputs', () => {
		useOutputsStore.setState({ ids: [], currentId: null });
		renderWithProviders(<Filmstrip />);

		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
	});
});
