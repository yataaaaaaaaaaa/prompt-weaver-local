import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { outputImageUrl } from '../../api/config';
import { useOutputsStore } from '../../stores/outputsStore';
import { renderWithProviders } from '../../test/render';
import { ImagePane } from './ImagePane';

describe('ImagePane', () => {
	it('shows the current output image from the backend', () => {
		useOutputsStore.setState({ ids: ['0000000041', '0000000042'], currentId: '0000000042' });
		renderWithProviders(<ImagePane />);

		const image = screen.getByRole('img', { name: 'Output 0000000042' });
		expect(image).toHaveAttribute('src', outputImageUrl('0000000042'));
	});

	it('shows an empty state without a current output', () => {
		useOutputsStore.setState({ ids: [], currentId: null });
		renderWithProviders(<ImagePane />);

		expect(screen.getByText('No image selected.')).toBeInTheDocument();
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
	});
});
