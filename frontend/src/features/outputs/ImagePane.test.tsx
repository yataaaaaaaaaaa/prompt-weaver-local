import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { outputImageUrl } from '../../api/config';
import { useOutputsStore } from '../../stores/outputsStore';
import { renderWithProviders } from '../../test/render';
import { ImagePane } from './ImagePane';

describe('ImagePane', () => {
	it('shows the current output image from the backend, fitted without distortion', () => {
		useOutputsStore.setState({ ids: ['0000000041', '0000000042'], currentId: '0000000042' });
		renderWithProviders(<ImagePane />);

		const image = screen.getByRole('img', { name: 'Output 0000000042' });
		expect(image).toHaveAttribute('src', outputImageUrl('0000000042'));
		expect(image.className).toMatch(/fui-Image/);
	});

	it('says there are no outputs yet', () => {
		useOutputsStore.setState({ ids: [], currentId: null });
		renderWithProviders(<ImagePane />);

		expect(screen.getByRole('status')).toHaveTextContent('No outputs yet.Generated images appear here.');
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
	});

	it('says no image is selected when outputs exist', () => {
		useOutputsStore.setState({ ids: ['0000000001'], currentId: null });
		renderWithProviders(<ImagePane />);

		expect(screen.getByText('No image selected.')).toBeInTheDocument();
	});

	it('replaces a picture that cannot be loaded with an explanation, and shows the next output again', () => {
		useOutputsStore.setState({ ids: ['0000000003', '0000000004'], currentId: '0000000004' });
		renderWithProviders(<ImagePane />);

		fireEvent.error(screen.getByRole('img', { name: 'Output 0000000004' }));

		expect(screen.queryByRole('img')).not.toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('The image of output #0000000004 could not be loaded.');
		expect(screen.getByText('Its file may have been moved or deleted outside the app.')).toBeInTheDocument();

		act(() => useOutputsStore.setState({ currentId: '0000000003' }));
		expect(screen.getByRole('img', { name: 'Output 0000000003' })).toHaveAttribute('src', outputImageUrl('0000000003'));
	});
});
