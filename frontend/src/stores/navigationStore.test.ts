import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTION } from '../app/sections';
import { useLayoutStore } from './layoutStore';
import { useNotificationsStore } from './notificationsStore';
import { goToSectionAction, isActionApplicable, useNavigationStore } from './navigationStore';

const store = () => useNavigationStore.getState();

describe('navigationStore', () => {
	it('starts on the default section, visited', () => {
		expect(store().section).toBe(DEFAULT_SECTION);
		expect(store().visited).toEqual({ [DEFAULT_SECTION]: true });
	});

	it('shows a section and remembers it was visited', () => {
		store().showSection('models');
		expect(store().section).toBe('models');
		store().showSection('create');
		expect(store().section).toBe('create');
		expect(store().visited).toEqual({ create: true, models: true });
	});

	it('keeps the same state when the shown section is shown again', () => {
		const before = store();
		store().showSection(DEFAULT_SECTION);
		expect(store()).toBe(before);
	});

	it('numbers every region cycle and search focus request', () => {
		store().cycleRegion(1);
		store().cycleRegion(1);
		expect(store().regionCycle).toEqual({ value: 1, serial: 2 });
		store().cycleRegion(-1);
		expect(store().regionCycle).toEqual({ value: -1, serial: 3 });

		store().showSection('images');
		store().focusSearch();
		expect(store().searchFocus).toEqual({ value: 'images', serial: 1 });
	});

	it('asks the shell to focus a section shown from the keyboard, even one already shown', () => {
		store().showSection('models', { focus: true });
		expect(store().section).toBe('models');
		expect(store().sectionFocus).toEqual({ value: 'models', serial: 1 });

		store().showSection('models', { focus: true });
		expect(store().sectionFocus).toEqual({ value: 'models', serial: 2 });
	});

	it('leaves the focus alone for a section shown by pointer or by a hand-off', () => {
		store().showSection('images');
		store().showSection('characters', { focus: false });

		expect(store().section).toBe('characters');
		expect(store().sectionFocus).toBeNull();
		expect(store().visited).toEqual({ create: true, images: true, characters: true });
	});

	it('expands a collapsed prompt board before searching in Create (its search box lives there)', () => {
		useLayoutStore.getState().setRegionCollapsed('board', true);

		store().focusSearch();

		expect(useLayoutStore.getState().collapsed.board).toBe(false);
		expect(store().searchFocus).toEqual({ value: 'create', serial: 1 });
	});

	it('leaves the Create layout alone when searching in another section', () => {
		useLayoutStore.getState().setRegionCollapsed('board', true);
		store().showSection('models');

		store().focusSearch();

		expect(useLayoutStore.getState().collapsed.board).toBe(true);
	});

	it('builds the "Go to <section>" action of hand-off notifications', () => {
		const id = useNotificationsStore.getState().notify('success', 'LoRAs selected.', { action: goToSectionAction('create') });
		store().showSection('images');

		expect(useNotificationsStore.getState().notifications[0].action?.label).toBe('Go to Create');
		useNotificationsStore.getState().runAction(id);

		expect(store().section).toBe('create');
	});

	it("offers a 'Go to <section>' action only while another section is shown", () => {
		const action = goToSectionAction('create');
		expect(action.section).toBe('create');
		expect(isActionApplicable(action, 'images')).toBe(true);
		expect(isActionApplicable(action, 'create')).toBe(false);
		expect(isActionApplicable({ label: 'Retry', run: () => undefined }, 'create')).toBe(true);
	});
});
