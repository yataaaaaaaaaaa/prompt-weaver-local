import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { FactList } from './FactList';

describe('FactList', () => {
	it('renders a labelled definition list, one term and value per fact, in order', () => {
		renderWithProviders(
			<FactList
				label="Output details"
				facts={[
					{ term: 'Seed', value: '42' },
					{ term: 'Model', value: <strong>Dreamline</strong> },
				]}
			/>,
		);

		const list = screen.getByLabelText('Output details');
		expect(list.tagName).toBe('DL');
		expect(Array.from(list.querySelectorAll('dt')).map((term) => term.textContent)).toEqual(['Seed', 'Model']);
		expect(Array.from(list.querySelectorAll('dd')).map((value) => value.textContent)).toEqual(['42', 'Dreamline']);
		expect(within(list).getByText('Dreamline').tagName).toBe('STRONG');
	});

	it('the small size draws smaller values', () => {
		const { rerender } = renderWithProviders(<FactList label="Folders" facts={[{ term: 'Adapter folder', value: 'D:/models' }]} />);
		const valueClass = () => screen.getByText('D:/models').className;
		const medium = valueClass();

		rerender(<FactList label="Folders" size="small" facts={[{ term: 'Adapter folder', value: 'D:/models' }]} />);
		expect(valueClass()).not.toBe(medium);
		expect(screen.getByLabelText('Folders')).toBeInTheDocument();
	});
});
