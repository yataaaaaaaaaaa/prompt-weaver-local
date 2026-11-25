import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { LoadMoreButton } from './LoadMoreButton';

describe('LoadMoreButton', () => {
	it('loads more on click', async () => {
		const onLoadMore = vi.fn();
		const { user } = renderWithProviders(<LoadMoreButton loading={false} loadingLabel="Loading more images…" onLoadMore={onLoadMore} />);

		const button = screen.getByRole('button', { name: 'Load more' });
		expect(button).not.toHaveAttribute('aria-disabled', 'true');
		await user.click(button);
		expect(onLoadMore).toHaveBeenCalledTimes(1);
	});

	it('shows the loading text and ignores clicks while the page loads, staying focusable', async () => {
		const onLoadMore = vi.fn();
		const { user } = renderWithProviders(<LoadMoreButton loading loadingLabel="Loading more images…" onLoadMore={onLoadMore} />);

		const button = screen.getByRole('button', { name: 'Loading more images…' });
		expect(button).toHaveAttribute('aria-disabled', 'true');
		expect(button).toHaveAttribute('aria-busy', 'true');
		await user.click(button);
		expect(onLoadMore).not.toHaveBeenCalled();
		button.focus();
		expect(button).toHaveFocus();
	});

	it('keeps the keyboard focus when the next page starts loading', async () => {
		const onLoadMore = vi.fn();
		const { user, rerender } = renderWithProviders(<LoadMoreButton loading={false} loadingLabel="Loading more models…" onLoadMore={onLoadMore} />);

		await user.tab();
		const button = screen.getByRole('button', { name: 'Load more' });
		expect(button).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(onLoadMore).toHaveBeenCalledTimes(1);

		rerender(<LoadMoreButton loading loadingLabel="Loading more models…" onLoadMore={onLoadMore} />);
		expect(screen.getByRole('button', { name: 'Loading more models…' })).toBe(button);
		expect(button).toHaveFocus();
	});
});
