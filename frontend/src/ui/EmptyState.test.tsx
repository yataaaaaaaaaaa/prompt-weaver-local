import { screen } from '@testing-library/react';
import { SparkleRegular } from '@fluentui/react-icons';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
	it('shows the title as a heading, the guidance paragraphs and the actions; the icon is decorative', () => {
		const { container } = renderWithProviders(
			<EmptyState icon={SparkleRegular} title="Pick a model" actions={<button type="button">Browse models</button>}>
				<p>One.</p>
				<p>Two.</p>
			</EmptyState>,
		);

		expect(screen.getByRole('heading', { name: 'Pick a model', level: 2 })).toBeInTheDocument();
		expect(screen.getByText('One.').tagName).toBe('P');
		expect(screen.getByText('Two.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Browse models' })).toBeInTheDocument();
		expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('renders plain title text inside a part that has its own heading, and announces a live state', () => {
		renderWithProviders(
			<EmptyState icon={SparkleRegular} title="No outputs yet" titleAs="p" live size="small">
				Press Generate.
			</EmptyState>,
		);

		expect(screen.queryByRole('heading')).not.toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('No outputs yetPress Generate.');
	});
});
