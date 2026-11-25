import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { BaseModelBadge, LocalFileBadge, ModelKindBadge, NotSupportedLocallyBadge, NsfwBadge, SelectedBadge, VersionNameBadge } from './ModelBadges';

// The colors themselves are checked in the real browser (e2e/models: every badge's text contrast in both themes).
describe('ModelBadges', () => {
	it('shows the model kind label', () => {
		renderWithProviders(
			<>
				<ModelKindBadge kind="checkpoint" />
				<ModelKindBadge kind="lora" />
				<ModelKindBadge kind="embedding" />
			</>,
		);
		expect(screen.getByText('Checkpoint')).toBeInTheDocument();
		expect(screen.getByText('LoRA')).toBeInTheDocument();
		expect(screen.getByText('Embedding')).toBeInTheDocument();
	});

	it('shows the base model and the version name as given', () => {
		renderWithProviders(
			<>
				<BaseModelBadge baseModel="SDXL 1.0" />
				<VersionNameBadge name="v1.2" />
			</>,
		);
		expect(screen.getByText('SDXL 1.0')).toBeInTheDocument();
		expect(screen.getByText('v1.2')).toBeInTheDocument();
	});

	it.each([
		['Local file', <LocalFileBadge key="local" />],
		['NSFW', <NsfwBadge key="nsfw" />],
		['Not supported locally', <NotSupportedLocallyBadge key="unsupported" />],
		['Selected', <SelectedBadge key="selected" />],
	])('%s has an icon next to its text (color is never the only cue)', (label, badge) => {
		renderWithProviders(badge);
		const element = screen.getByText(label);
		expect(element.closest('.fui-Badge')?.querySelector('svg')).not.toBeNull();
	});
});
