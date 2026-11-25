import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathText } from './PathText';

describe('PathText', () => {
	it('shows the whole path with a line break opportunity after each separator', () => {
		const { container } = render(
			<span>
				<PathText path="C:/Users/me/models/loras/watercolor_wash.safetensors" />
			</span>,
		);
		expect(container.textContent).toBe('C:/Users/me/models/loras/watercolor_wash.safetensors');
		expect(container.querySelectorAll('wbr')).toHaveLength(5);
	});

	it('renders a bare file name without break opportunity', () => {
		const { container } = render(
			<span>
				<PathText path="model.safetensors" />
			</span>,
		);
		expect(container.textContent).toBe('model.safetensors');
		expect(container.querySelectorAll('wbr')).toHaveLength(0);
	});
});
