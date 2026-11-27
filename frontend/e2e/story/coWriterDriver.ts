// Helpers of the co-writer specs (e2e/story/coWriter.spec.ts): the panel in the Story section's dock by the accessible
// names of src/features/coWriter/coWriterLabels.ts, its conversation, and the fake Codex scenarios (the fake app-server
// of backend/tests/fake_codex.py: rules {match, steps} of what it says and which app tools it calls).
import { expect, type Locator, type Page } from '@playwright/test';
import { CO_WRITER_LABELS, CO_WRITER_STATE_ATTRIBUTE, showTargetLabel } from '../../src/features/coWriter/coWriterLabels';
import { expandDockLabel } from '../../src/ui/dockLabels';
import type { StoryDriver } from './storyDriver';

/** A rule of the fake Codex: when the user's words match, these steps run. */
export type FakeRule = { match: string; steps: Record<string, unknown>[] };

export function rule(match: string, ...steps: Record<string, unknown>[]): FakeRule {
	return { match, steps };
}

export class CoWriterDriver {
	constructor(readonly story: StoryDriver) {}

	get page(): Page {
		return this.story.page;
	}

	/** The dock (complementary landmark 'Co-writer'). */
	dock(): Locator {
		return this.story.section().getByRole('complementary', { name: CO_WRITER_LABELS.panel, exact: true });
	}

	/** The panel's root, with its state attribute. */
	panel(): Locator {
		return this.dock().locator(`[${CO_WRITER_STATE_ATTRIBUTE}]`);
	}

	async expectState(state: string): Promise<void> {
		await expect(this.panel()).toHaveAttribute(CO_WRITER_STATE_ATTRIBUTE, state, { timeout: 20_000 });
	}

	commands(): Locator {
		return this.dock().getByRole('toolbar', { name: CO_WRITER_LABELS.commands, exact: true });
	}

	command(name: string): Locator {
		return this.commands().getByRole('button', { name, exact: true });
	}

	log(): Locator {
		return this.dock().getByRole('log', { name: CO_WRITER_LABELS.transcript, exact: true });
	}

	messageBox(): Locator {
		return this.dock().getByRole('textbox', { name: CO_WRITER_LABELS.message, exact: true });
	}

	button(name: string): Locator {
		return this.dock().getByRole('button', { name, exact: true });
	}

	/** The entries of the conversation of one kind ('user', 'assistant', 'tool', 'error', 'notice'). */
	entries(kind: string): Locator {
		return this.log().locator(`[data-entry-kind="${kind}"]`);
	}

	/** The link of a tool row to its scene ('Show Scene 4 · The harbor'). */
	showLink(target: string): Locator {
		return this.log().getByRole('button', { name: showTargetLabel(target), exact: true });
	}

	/** The Expand button of the collapsed dock. */
	expand(): Locator {
		return this.dock().getByRole('button', { name: expandDockLabel(CO_WRITER_LABELS.panel), exact: true });
	}

	/** Types a message and sends it with Enter; waits for the user's entry. */
	async send(text: string): Promise<void> {
		const before = await this.entries('user').count();
		await this.messageBox().fill(text);
		await this.messageBox().press('Enter');
		await expect(this.entries('user')).toHaveCount(before + 1);
		await expect(this.entries('user').last()).toHaveText(text);
	}

	/** Waits until Codex answered (Send is back). */
	async waitForAnswer(timeout = 30_000): Promise<void> {
		await expect(this.button(CO_WRITER_LABELS.send)).toBeVisible({ timeout });
		await expect(this.button(CO_WRITER_LABELS.stop)).toHaveCount(0);
	}
}
