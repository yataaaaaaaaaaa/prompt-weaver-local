import { describe, expect, it } from 'vitest';
import { PANES } from './paneRegistry';

describe('pane registry', () => {
	it('keeps the persisted pane ids (window layouts and hidden panes are stored by id)', () => {
		expect(PANES.map((pane) => pane.id)).toEqual(['image', 'browser', 'controls', 'used', 'models', 'images']);
	});

	it('declares each pane once with a title, an icon, a view and a usable default layout', () => {
		expect(new Set(PANES.map((pane) => pane.id)).size).toBe(PANES.length);
		for (const pane of PANES) {
			expect(pane.title).not.toBe('');
			expect(pane.icon).toBeTruthy();
			expect(pane.component).toBeTruthy();
			expect(pane.defaultLayout.width).toBeGreaterThan(0);
			expect(pane.defaultLayout.height).toBeGreaterThan(0);
		}
	});
});
