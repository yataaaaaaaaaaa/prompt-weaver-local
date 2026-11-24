import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '../../domain/categories';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCurrentSelectionKey } from '../../stores/outputsStore';
import { renderWithProviders } from '../../test/render';
import { SubPromptList } from './SubPromptList';

vi.mock('../../stores/outputsStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/outputsStore')>();
	return { ...actual, useIsSubPromptInCurrentOutput: vi.fn(() => false), useCurrentSelectionKey: vi.fn() };
});

function category(texts: string[]): Category {
	return {
		text: 'Pose',
		activation_text: '',
		priority: 1,
		state: 'normal',
		subPrompts: texts.map((text) => ({ text, state: 'normal' as const, extraLoraIds: [] })),
	};
}

/** jsdom has no layout: give elements the geometry the scroll logic reads. */
function setGeometry(element: HTMLElement, geometry: Partial<Record<'offsetTop' | 'offsetHeight' | 'clientHeight' | 'scrollHeight', number>>) {
	for (const [name, value] of Object.entries(geometry)) {
		Object.defineProperty(element, name, { configurable: true, value });
	}
}

beforeEach(() => {
	vi.mocked(useCurrentSelectionKey).mockReset().mockReturnValue(null);
});

describe('SubPromptList', () => {
	it('scrolls the sub-prompt used by the current output into view', () => {
		useCategoriesStore.setState({ categories: [category(['sit', 'stand', 'run'])] });
		const { rerender } = renderWithProviders(<SubPromptList categoryKey="pose" />);
		const list = screen.getByRole('list', { name: 'Sub-prompts' });
		const items = screen.getAllByRole('listitem');
		setGeometry(list, { clientHeight: 100 });
		setGeometry(items[2], { offsetTop: 300, offsetHeight: 40 });

		vi.mocked(useCurrentSelectionKey).mockReturnValue('run');
		rerender(<SubPromptList categoryKey="pose" />);
		expect(list.scrollTop).toBe(240);

		setGeometry(items[0], { offsetTop: 0, offsetHeight: 40 });
		vi.mocked(useCurrentSelectionKey).mockReturnValue('sit');
		rerender(<SubPromptList categoryKey="pose" />);
		expect(list.scrollTop).toBe(0);
	});

	it('scrolls to the bottom when a sub-prompt is added, not when one is removed', () => {
		useCategoriesStore.setState({ categories: [category(['sit', 'stand'])] });
		renderWithProviders(<SubPromptList categoryKey="pose" />);
		const list = screen.getByRole('list', { name: 'Sub-prompts' });
		setGeometry(list, { scrollHeight: 500 });
		expect(list.scrollTop).toBe(0);

		act(() => {
			useCategoriesStore.setState({ categories: [category(['sit', 'stand', ''])] });
		});
		expect(list.scrollTop).toBe(500);

		list.scrollTop = 10;
		act(() => {
			useCategoriesStore.setState({ categories: [category(['sit'])] });
		});
		expect(list.scrollTop).toBe(10);
	});
});
