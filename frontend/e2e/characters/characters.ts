// Helpers of the characters e2e specs (e2e/characters/*.spec.ts, e2e/journeys/keep-character.spec.ts), built on the
// shared AppDriver: the Characters section and its parts by their accessible names (toolbar search, gallery, detail
// panel with the details / editor / IP-Adapter section), the Character section of the Create section's generation
// panel, the fixture characters (backend/tests/e2e/fixtures/data/characters/characters.json) and geometry checks of
// what the user sees.
import { expect, type Locator, type Page } from '@playwright/test';
import type { CharacterCollection } from '../../src/api/types';
import { toast, type AppDriver } from '../support/app';
import type { E2EBackend } from '../support/backend';
import { boxOf } from '../support/visibility';

/** The fixture characters (synthetic data of the e2e backend), in the gallery order (sorted by name). */
export const MIRA = { id: 'chr-aaaaaaaaaaa1', name: 'Mira' } as const;
export const BRAM = { id: 'chr-bbbbbbbbbbb1', name: 'Bram the knight' } as const;
export const NOVA = { id: 'chr-ccccccccccc1', name: 'Nova' } as const;
export const FIXTURE_CHARACTER_NAMES = [BRAM.name, MIRA.name, NOVA.name] as const;

/** The selected model of the fixture library (SDXL header) and the SD 1.5 one. */
export const SDXL_MODEL = 'studio_xl_local.safetensors';
export const SD15_MODEL = 'classic_sd15_local.safetensors';

/** IP-Adapter catalog labels and file names (backend/app/services/ip_adapters.py, production catalog). */
export const SDXL_FACE = 'SDXL face (IP-Adapter Plus Face ViT-H)';
export const SDXL_FACE_ADAPTER = 'ip-adapter-plus-face_sdxl_vit-h.safetensors';
export const IMAGE_ENCODER = 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors';

/** The characters collection as the backend holds it (GET /api/characters). */
export function characterCollection(backend: E2EBackend): Promise<CharacterCollection> {
	return backend.get<CharacterCollection>('/api/characters');
}

/** Names of the characters the backend holds. */
export async function backendCharacterNames(backend: E2EBackend): Promise<string[]> {
	return (await characterCollection(backend)).items.map((character) => character.name).sort();
}

export class CharactersDriver {
	constructor(readonly app: AppDriver) {}

	get page(): Page {
		return this.app.page;
	}

	/** Shows the Characters section (navigation rail) and returns it. */
	open(): Promise<Locator> {
		return this.app.goTo('characters');
	}

	/** The Characters section (<main> landmark). */
	section(): Locator {
		return this.app.section('characters');
	}

	/** The gallery search of the section's toolbar. */
	search(): Locator {
		return this.section().getByRole('searchbox', { name: 'Search characters', exact: true });
	}

	/** New character in the section's toolbar (the header row of the section). */
	newCharacter(): Locator {
		return this.section().locator('header').getByRole('button', { name: 'New character', exact: true });
	}

	/** The count of the toolbar ('3 characters', '1 of 3 characters'). */
	count(): Locator {
		return this.section().locator('header').getByRole('status');
	}

	gallery(): Locator {
		return this.section().getByRole('region', { name: 'Character gallery', exact: true });
	}

	/** The gallery card (Fluent Card, a group named by the character's name). */
	card(name: string): Locator {
		return this.gallery().getByRole('group', { name, exact: true });
	}

	/** The card's picture: the button selecting the card (named by the character). */
	selectButton(name: string): Locator {
		return this.card(name).getByRole('button', { name, exact: true });
	}

	activeSwitch(name: string): Locator {
		return this.card(name).getByRole('switch', { name: 'Active' });
	}

	/** The detail panel (complementary landmark): the editor or the selected character's details, then the IP-Adapter
	 *  section. */
	details(): Locator {
		return this.section().getByRole('complementary', { name: 'Character details', exact: true });
	}

	/** The details of the selected character (a section of the detail panel named by the character). */
	detailsOf(name: string): Locator {
		return this.details().getByRole('region', { name, exact: true });
	}

	/** The open editor: a section titled 'New character' or 'Edit <name>'. */
	editor(title: string): Locator {
		return this.details().getByRole('region', { name: title, exact: true });
	}

	editorActions(): Locator {
		return this.details().getByRole('group', { name: 'Character editor actions' });
	}

	references(): Locator {
		return this.details().getByRole('group', { name: 'Reference images', exact: true });
	}

	ipAdapter(): Locator {
		return this.details().getByRole('region', { name: 'Reference images (IP-Adapter)', exact: true });
	}

	/** The reference support entry of a focus ('Face', 'Whole subject') in the IP-Adapter section. */
	support(focusLabel: string): Locator {
		return this.ipAdapter()
			.getByRole('list', { name: 'Reference support' })
			.getByRole('listitem')
			.filter({ has: this.page.getByText(focusLabel, { exact: true }) });
	}

	/** The Character section of the generation panel (Create section). */
	generationSection(): Locator {
		return this.app.createRegion('generation').getByRole('region', { name: 'Character', exact: true });
	}

	/** The toast (a Fluent MessageBar of the Notifications region) saying `message`; its follow-up action ('Go to
	 *  <section>') is one of its buttons. */
	toast(message: string): Locator {
		return toast(this.page, message);
	}

	/** Activates (or deactivates) a character with its card's Active switch and waits for the backend's answer. */
	async toggleActive(name: string, active: boolean): Promise<void> {
		await this.activeSwitch(name).click();
		await expect(this.activeSwitch(name)).toBeChecked({ checked: active });
		await expect(this.activeSwitch(name)).toBeEnabled();
	}
}

/** The vertical center of an element (page coordinates). */
export async function centerY(locator: Locator): Promise<number> {
	const box = await boxOf(locator);
	return box.y + box.height / 2;
}

/** `inner` lies entirely inside `outer` (e.g. a button inside the visible part of its panel). */
export async function expectInside(inner: Locator, outer: Locator, what: string): Promise<void> {
	const [a, b] = [await boxOf(inner), await boxOf(outer)];
	expect(
		a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5,
		`${what}: ${JSON.stringify(a)} is not inside ${JSON.stringify(b)}`,
	).toBe(true);
}

/** `inner` is centered in `outer` (within `tolerance` px on both axes). */
export async function expectCentered(inner: Locator, outer: Locator, what: string, tolerance = 2): Promise<void> {
	const [a, b] = [await boxOf(inner), await boxOf(outer)];
	const dx = Math.abs(a.x + a.width / 2 - (b.x + b.width / 2));
	const dy = Math.abs(a.y + a.height / 2 - (b.y + b.height / 2));
	expect(dx <= tolerance && dy <= tolerance, `${what}: off center by ${dx.toFixed(1)} x ${dy.toFixed(1)} px`).toBe(true);
}

/** Scrolls the element's scroll container so that the element's bottom edge is the container's visible bottom edge:
 *  the position where a sticky footer would hide it while the browser counts it as visible. */
export async function scrollToBottomEdge(locator: Locator): Promise<void> {
	await locator.evaluate((element) => {
		let scroller = element.parentElement;
		while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
			scroller = scroller.parentElement;
		}
		if (!scroller) {
			throw new Error('the element has no scroll container');
		}
		scroller.scrollTop += element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
	});
}
