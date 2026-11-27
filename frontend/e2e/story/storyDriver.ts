// Helpers of the Story e2e specs (e2e/story/*.spec.ts), built on the shared AppDriver: the Story section and its
// parts by their accessible names (src/features/story/storyLabels.ts: the commands toolbar, the 'Stories' list, the
// 'Scenes' storyboard with its scene cards, the 'Scene details' panel, the 'Reader'), the fixture stories
// (backend/tests/e2e/fixtures/data/stories/stories.json) and the stories and outputs as the backend holds them.
import { expect, type Locator, type Page } from '@playwright/test';
import type { OutputRecord, Story, StoryCollection } from '../../src/api/types';
import { sceneCardName, STORY_LABELS } from '../../src/features/story/storyLabels';
import type { AppDriver } from '../support/app';
import type { E2EBackend } from '../support/backend';

/** The fixture stories (synthetic data of the e2e backend). */
export const LIGHTHOUSE = {
	id: 'sty-aaaaaaaaaaa1',
	title: 'The lighthouse keeper',
	scenes: ['Arrival at the lighthouse', 'The storm', 'Morning calm'],
	sceneIds: ['scn-aaaaaaaaaaa1', 'scn-aaaaaaaaaaa2', 'scn-aaaaaaaaaaa3'],
} as const;
export const BRAMS_QUEST = { id: 'sty-bbbbbbbbbbb1', title: "Bram's quest", scenes: ['The castle gate'] } as const;

/** What Mira (the lighthouse keeper's character, fixture characters.json) adds to every generation of its scenes. */
export const MIRA_PROMPT = { identity: '1girl, short red hair, green eyes, freckles', outfit: 'leather jacket, white scarf' } as const;
export const MIRA_LORA = { id: 'watercolor-wash-safetensors', weight: 0.5 } as const;
export const MIRA_ID = 'chr-aaaaaaaaaaa1';

export function storyCollection(backend: E2EBackend): Promise<StoryCollection> {
	return backend.get<StoryCollection>('/api/stories');
}

export function backendStory(backend: E2EBackend, storyId: string): Promise<Story> {
	return backend.get<Story>(`/api/stories/${storyId}`);
}

export function backendOutput(backend: E2EBackend, outputId: string): Promise<OutputRecord> {
	return backend.get<OutputRecord>(`/api/outputs/${outputId}`);
}

export class StoryDriver {
	constructor(readonly app: AppDriver) {}

	get page(): Page {
		return this.app.page;
	}

	/** Shows the Story section (navigation rail) and returns it. */
	open(): Promise<Locator> {
		return this.app.goTo('story');
	}

	section(): Locator {
		return this.app.section('story');
	}

	commands(): Locator {
		return this.section().getByRole('toolbar', { name: STORY_LABELS.commands, exact: true });
	}

	command(name: string | RegExp): Locator {
		return this.commands().getByRole('button', { name, exact: typeof name === 'string' });
	}

	generateMissing(): Locator {
		return this.command(new RegExp(`^${STORY_LABELS.generateMissing} \\(\\d+\\)$`));
	}

	storyList(): Locator {
		return this.section().getByRole('navigation', { name: STORY_LABELS.storyList, exact: true });
	}

	/** The item of a story in the list (named by its title and progress). */
	storyItem(title: string): Locator {
		return this.storyList().getByRole('button').filter({ hasText: title });
	}

	scenes(): Locator {
		return this.section().getByRole('region', { name: STORY_LABELS.scenes, exact: true });
	}

	details(): Locator {
		return this.section().getByRole('complementary', { name: STORY_LABELS.sceneDetails, exact: true });
	}

	reader(): Locator {
		return this.section().getByRole('region', { name: STORY_LABELS.reader, exact: true });
	}

	/** The scene card at 1-based `position` titled `title`. */
	card(position: number, title: string): Locator {
		return this.scenes().getByRole('group', { name: sceneCardName(position, title), exact: true });
	}

	/** Every scene card of the storyboard, in order. */
	cards(): Locator {
		return this.scenes().getByRole('list', { name: STORY_LABELS.sceneList, exact: true }).getByRole('group');
	}

	/** The titles of the scene cards, in order. */
	async cardTitles(): Promise<string[]> {
		const names = await this.cards().evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label') ?? ''));
		return names.map((name) => name.replace(/^Scene \d+: /, ''));
	}

	/** The status badge text of a card ('Illustrated', 'Not illustrated', 'Generating', 'Queued'). */
	status(card: Locator): Locator {
		return card.locator('[data-scene-status]');
	}

	/** Opens the scene in the detail panel (its picture button) and waits for its heading. */
	async openScene(position: number, title: string): Promise<Locator> {
		await this.card(position, title).getByRole('button', { name: title, exact: true }).click();
		await expect(this.details().getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
		return this.details();
	}

	/** The reorder handle of a card. */
	handle(card: Locator, title: string): Locator {
		return card.getByRole('button', { name: `Reorder ${title}`, exact: true });
	}

	/** The polite live region announcing scene moves. */
	announcer(): Locator {
		return this.scenes().locator('[role="status"][aria-live="polite"]');
	}

	/** Fills a field of the details and leaves it (the edit is saved on blur), waiting for the PATCH. */
	async editField(label: string, value: string): Promise<void> {
		const field = this.details().getByRole('textbox', { name: label, exact: true });
		const saved = this.page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/api/stories/'));
		await field.fill(value);
		await field.press('Tab');
		expect((await saved).ok()).toBe(true);
	}
}
