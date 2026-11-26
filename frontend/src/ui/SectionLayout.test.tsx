import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { F6_REGION_ATTRIBUTE } from '../app/sections';
import { renderWithProviders } from '../test/render';
import { SectionLayout } from './SectionLayout';

describe('SectionLayout', () => {
	it('shows the title, the toolbar, the results region and the detail panel', () => {
		renderWithProviders(
			<SectionLayout
				title="Models"
				toolbar={<input aria-label="Search models" />}
				results={<p>Result grid</p>}
				resultsLabel="Model search results"
				detail={<p>Pixel Forge</p>}
				detailLabel="Model details"
			/>,
		);

		expect(screen.getByRole('heading', { level: 1, name: 'Models' })).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'Search models' })).toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Model search results' })).toHaveTextContent('Result grid');
		expect(screen.getByRole('complementary', { name: 'Model details' })).toHaveTextContent('Pixel Forge');
	});

	it('shows the empty detail while nothing is selected', () => {
		renderWithProviders(
			<SectionLayout
				title="Images"
				results={null}
				resultsLabel="Image search results"
				detail={null}
				detailLabel="Image details"
				emptyDetail={<p>Pick an image to see its details.</p>}
			/>,
		);

		expect(screen.getByRole('complementary', { name: 'Image details' })).toHaveTextContent('Pick an image to see its details.');
	});

	it('marks its header, results and detail panel as F6 regions', () => {
		const { container } = renderWithProviders(
			<SectionLayout title="Characters" results={null} resultsLabel="Characters" detail={null} detailLabel="Character editor" />,
		);

		const regions = Array.from(container.querySelectorAll(`[${F6_REGION_ATTRIBUTE}]`)).map((element) => element.getAttribute(F6_REGION_ATTRIBUTE));
		expect(regions).toEqual(['toolbar', 'results', 'detail']);
	});
});
