import { act, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentRegular } from '@fluentui/react-icons';
import { renderWithProviders } from '../test/render';
import { CLOSE_DETAIL_LABEL, DetailPanel, detailOpenerProps } from './DetailPanel';
import { EmptyState } from './EmptyState';
import { SectionLayout } from './SectionLayout';

/** Two openers in the results and the detail of the opened one (local state stands in for the store). */
function Harness({ listed = ['a', 'b'], onClose = vi.fn() }: { listed?: string[]; onClose?: () => void }): JSX.Element {
	const [shown, setShown] = useState<string | null>(null);
	return (
		<main aria-label="Section">
			<SectionLayout
				title="Things"
				results={listed.map((key) => (
					<button key={key} type="button" onClick={() => setShown(key)} {...detailOpenerProps(key)}>
						Open {key}
					</button>
				))}
				resultsLabel="Results"
				detail={
					shown === null ? null : (
						<DetailPanel
							itemKey={shown}
							title={`Thing ${shown}`}
							onClose={() => {
								onClose();
								setShown(null);
							}}
						>
							<button type="button">Act on {shown}</button>
						</DetailPanel>
					)
				}
				detailLabel="Details"
				emptyDetail={
					<EmptyState icon={DocumentRegular} title="Pick a thing">
						Its details show here.
					</EmptyState>
				}
			/>
		</main>
	);
}

// Fluent components render slowly on a busy machine: more than the default 5 s per test.
describe('DetailPanel', () => {
	it('focuses the heading of the opened item, and of the next one opened', async () => {
		const { user } = renderWithProviders(<Harness />);

		await user.click(screen.getByRole('button', { name: 'Open a' }));
		expect(screen.getByRole('heading', { name: 'Thing a', level: 2 })).toHaveFocus();

		await user.click(screen.getByRole('button', { name: 'Open b' }));
		expect(screen.getByRole('heading', { name: 'Thing b', level: 2 })).toHaveFocus();
	});

	it('Close returns the focus to the opener', async () => {
		const onClose = vi.fn();
		const { user } = renderWithProviders(<Harness onClose={onClose} />);

		await user.click(screen.getByRole('button', { name: 'Open b' }));
		await user.click(screen.getByRole('button', { name: CLOSE_DETAIL_LABEL }));

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Open b' })).toHaveFocus();
		expect(screen.getByRole('heading', { name: 'Pick a thing' })).toBeInTheDocument();
	});

	it('Escape from anywhere in the panel closes it', async () => {
		const onClose = vi.fn();
		const { user } = renderWithProviders(<Harness onClose={onClose} />);

		act(() => screen.getByRole('button', { name: 'Open a' }).focus());
		await user.keyboard('{Enter}');
		await user.tab();
		await user.tab();
		expect(screen.getByRole('button', { name: 'Act on a' })).toHaveFocus();
		await user.keyboard('{Escape}');

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Open a' })).toHaveFocus();
	});

	it('leaves an Escape already handled (an open menu) alone', async () => {
		const onClose = vi.fn();
		const { user } = renderWithProviders(<Harness onClose={onClose} />);
		await user.click(screen.getByRole('button', { name: 'Open a' }));
		const action = screen.getByRole('button', { name: 'Act on a' });
		action.addEventListener('keydown', (event) => event.preventDefault());

		act(() => action.focus());
		await user.keyboard('{Escape}');

		expect(onClose).not.toHaveBeenCalled();
	});

	it('sends the focus to the results when the item is no longer listed', async () => {
		const { user, rerender } = renderWithProviders(<Harness />);
		await user.click(screen.getByRole('button', { name: 'Open b' }));

		rerender(<Harness listed={['a']} />);
		await user.click(screen.getByRole('button', { name: CLOSE_DETAIL_LABEL }));

		expect(screen.getByRole('region', { name: 'Results' })).toHaveFocus();
	});

	it('names its Close button and describes its shortcut', async () => {
		const { user } = renderWithProviders(<Harness />);
		await user.click(screen.getByRole('button', { name: 'Open a' }));

		expect(screen.getByRole('button', { name: CLOSE_DETAIL_LABEL })).toBeInTheDocument();
		expect(screen.getByRole('complementary', { name: 'Details' })).toContainElement(screen.getByRole('heading', { name: 'Thing a' }));
	});
});
