import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VersionStatusKind } from '../../domain/modelCatalog';
import { renderWithProviders } from '../../test/render';
import { VERSION_STATUS_BADGES, VersionStatusBadge } from './VersionStatusBadge';

const KINDS = Object.keys(VERSION_STATUS_BADGES) as VersionStatusKind[];

describe('VERSION_STATUS_BADGES', () => {
	it('gives every status its own label', () => {
		const labels = KINDS.map((kind) => VERSION_STATUS_BADGES[kind].label);
		expect(labels.every((label) => label.trim().length > 0)).toBe(true);
		expect(new Set(labels).size).toBe(KINDS.length);
		expect(KINDS.sort()).toEqual(['failed', 'in_library', 'installing', 'on_disk', 'remote', 'unavailable']);
	});

	it("labels a local copy 'On disk' (one label everywhere)", () => {
		expect(VERSION_STATUS_BADGES.on_disk.label).toBe('On disk');
		expect(VERSION_STATUS_BADGES.installing.label).toBe('Downloading');
		expect(VERSION_STATUS_BADGES.remote.label).toBe('Available to download');
	});
});

describe('VersionStatusBadge', () => {
	it('renders the label of its status, with extra props passed to the badge', () => {
		renderWithProviders(<VersionStatusBadge kind="on_disk" tabIndex={0} />);

		const badge = screen.getByText('On disk');
		expect(badge).toHaveAttribute('tabindex', '0');
		// The status icon is decorative next to the label.
		expect(badge.querySelector('svg')).not.toBeNull();
	});
});
