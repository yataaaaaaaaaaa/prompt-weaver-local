import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { PaneContent, PaneGrid, PaneSection } from './PaneLayout';

describe('PaneLayout', () => {
	it('renders a titled section as a region named by its heading, with its actions', () => {
		renderWithProviders(
			<PaneContent>
				<PaneSection title="Seeds" actions={<button>Reset</button>}>
					<p>Fields</p>
				</PaneSection>
			</PaneContent>,
		);
		const section = screen.getByRole('region', { name: 'Seeds' });
		expect(section).toContainElement(screen.getByRole('heading', { name: 'Seeds', level: 3 }));
		expect(section).toContainElement(screen.getByRole('button', { name: 'Reset' }));
		expect(section).toHaveTextContent('Fields');
	});

	it('takes a level 2 heading in a full-page detail panel', () => {
		renderWithProviders(<PaneSection title="Mira" level={2} />);
		expect(screen.getByRole('region', { name: 'Mira' })).toContainElement(screen.getByRole('heading', { name: 'Mira', level: 2 }));
	});

	it('PaneGrid: two columns by default; with a minimum column width it may stack (the width is a CSS variable)', () => {
		const { container, rerender } = renderWithProviders(
			<PaneGrid>
				<span>a</span>
				<span>b</span>
			</PaneGrid>,
		);
		const grid = () => container.firstElementChild?.firstElementChild as HTMLElement;
		const fixedClasses = grid().className;
		expect(grid().style.getPropertyValue('--pane-grid-min-column')).toBe('');

		rerender(
			<PaneGrid minColumnWidth="160px">
				<span>a</span>
				<span>b</span>
			</PaneGrid>,
		);
		expect(grid().style.getPropertyValue('--pane-grid-min-column')).toBe('160px');
		expect(grid().className).not.toBe(fixedClasses);
		expect(grid()).toHaveTextContent('ab');
	});
});
