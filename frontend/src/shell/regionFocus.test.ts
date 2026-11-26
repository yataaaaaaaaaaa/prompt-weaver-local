import { afterEach, describe, expect, it } from 'vitest';
import { F6_REGION_ATTRIBUTE, SECTION_SEARCH_ATTRIBUTE } from '../app/sections';
import { adjacentRegion, cycleRegionFocus, focusFirstRegion, focusSectionSearch, shownRegions } from './regionFocus';

/** A shell-like DOM: the rail, the shown Create section (commands, board with a nested region, viewer) and a hidden
 *  Models section. */
function buildShell(): HTMLElement {
	const root = document.createElement('div');
	root.innerHTML = `
		<nav ${F6_REGION_ATTRIBUTE}="nav" tabindex="-1"><button>Create</button></nav>
		<main data-section="create">
			<div ${F6_REGION_ATTRIBUTE}="commands" tabindex="-1"><button>Model</button></div>
			<section ${F6_REGION_ATTRIBUTE}="board" tabindex="-1">
				<input ${SECTION_SEARCH_ATTRIBUTE} value="hair" aria-label="Search categories" />
				<div ${F6_REGION_ATTRIBUTE}="board-inner" tabindex="-1"><button>Card</button></div>
			</section>
			<section ${F6_REGION_ATTRIBUTE}="viewer" tabindex="-1"><div hidden><div ${F6_REGION_ATTRIBUTE}="details" tabindex="-1"></div></div></section>
		</main>
		<main data-section="models" hidden>
			<header ${F6_REGION_ATTRIBUTE}="toolbar" tabindex="-1"><span ${SECTION_SEARCH_ATTRIBUTE}><input aria-label="Search models" /></span></header>
		</main>`;
	document.body.appendChild(root);
	return root;
}

const ids = (elements: Array<Element | null>) => elements.map((element) => element?.getAttribute(F6_REGION_ATTRIBUTE) ?? null);

afterEach(() => {
	document.body.innerHTML = '';
});

describe('shownRegions', () => {
	it('lists the F6 regions on screen in DOM order, skipping hidden sections and hidden content', () => {
		expect(ids(shownRegions(buildShell()))).toEqual(['nav', 'commands', 'board', 'board-inner', 'viewer']);
	});
});

describe('adjacentRegion', () => {
	it('moves forward and backward from the region holding the focus, wrapping around', () => {
		const regions = shownRegions(buildShell());
		const [nav, commands, , , viewer] = regions;

		expect(ids([adjacentRegion(regions, nav.querySelector('button'), 1)])).toEqual(['commands']);
		expect(ids([adjacentRegion(regions, commands, -1)])).toEqual(['nav']);
		expect(ids([adjacentRegion(regions, viewer, 1)])).toEqual(['nav']);
		expect(ids([adjacentRegion(regions, nav, -1)])).toEqual(['viewer']);
	});

	it('starts from the innermost region holding the focus', () => {
		const regions = shownRegions(buildShell());
		const card = regions[3].querySelector('button');

		expect(ids([adjacentRegion(regions, card, 1)])).toEqual(['viewer']);
		expect(ids([adjacentRegion(regions, card, -1)])).toEqual(['board']);
	});

	it('starts from the DOM position of a focused element between two regions (a splitter)', () => {
		const root = buildShell();
		const splitter = document.createElement('div');
		splitter.tabIndex = 0;
		root.querySelector(`[${F6_REGION_ATTRIBUTE}="viewer"]`)!.before(splitter);
		const regions = shownRegions(root);

		expect(ids([adjacentRegion(regions, splitter, 1)])).toEqual(['viewer']);
		expect(ids([adjacentRegion(regions, splitter, -1)])).toEqual(['board-inner']);

		const last = document.createElement('button');
		root.appendChild(last);
		expect(ids([adjacentRegion(regions, last, 1)])).toEqual(['nav']);
		expect(ids([adjacentRegion(regions, last, -1)])).toEqual(['viewer']);
	});

	it('goes to the first (F6) or the last (Shift+F6) region when the focus is in none', () => {
		const regions = shownRegions(buildShell());

		expect(ids([adjacentRegion(regions, document.body, 1)])).toEqual(['nav']);
		expect(ids([adjacentRegion(regions, null, -1)])).toEqual(['viewer']);
		expect(adjacentRegion([], document.body, 1)).toBeNull();
	});
});

describe('cycleRegionFocus', () => {
	it('focuses the next region', () => {
		const root = buildShell();
		root.querySelector<HTMLElement>('nav button')!.focus();

		const focused = cycleRegionFocus(root, document.activeElement, 1);

		expect(document.activeElement).toBe(focused);
		expect(focused?.getAttribute(F6_REGION_ATTRIBUTE)).toBe('commands');
	});

	it('never leaves a modal dialog', () => {
		const root = buildShell();
		const dialog = document.createElement('div');
		dialog.setAttribute('aria-modal', 'true');
		const button = document.createElement('button');
		dialog.appendChild(button);
		document.body.appendChild(dialog);
		button.focus();

		expect(cycleRegionFocus(root, document.activeElement, 1)).toBeNull();
		expect(document.activeElement).toBe(button);
	});
});

describe('focusFirstRegion', () => {
	it("focuses a section's first region on screen", () => {
		const root = buildShell();

		expect(focusFirstRegion(root.querySelector('[data-section="create"]'))?.getAttribute(F6_REGION_ATTRIBUTE)).toBe('commands');
		expect(document.activeElement?.getAttribute(F6_REGION_ATTRIBUTE)).toBe('commands');
		expect(focusFirstRegion(null)).toBeNull();
	});
});

describe('focusSectionSearch', () => {
	it('focuses the marked search field and selects its text', () => {
		const root = buildShell();
		const field = root.querySelector<HTMLInputElement>('[aria-label="Search categories"]')!;

		expect(focusSectionSearch(root.querySelector('[data-section="create"]'))).toBe(field);
		expect(document.activeElement).toBe(field);
		expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'hair'.length]);
	});

	it('focuses the text field inside a marked wrapper', () => {
		const root = buildShell();
		const models = root.querySelector<HTMLElement>('[data-section="models"]')!;
		models.hidden = false;

		expect(focusSectionSearch(models)).toBe(models.querySelector('input'));
	});

	it('does nothing without a search box on screen', () => {
		const root = buildShell();

		expect(focusSectionSearch(root.querySelector('[data-section="models"]'))).toBeNull();
		expect(focusSectionSearch(null)).toBeNull();
	});
});
