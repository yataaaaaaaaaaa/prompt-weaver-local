// The co-writer in the real browser: the user's Codex (here the fake app-server of backend/tests/fake_codex.py, reached
// by the real backend exactly like the installed Codex) docked in the Story section. A streamed answer; tool calls that
// add and edit a scene in the storyboard, and that illustrate a scene with the fake generator; Stop of an answer and of
// a generation; not found (then the user sets the path) and not signed in (then Retry); the conversation after a
// reload; the dock collapsed and expanded at 1280 x 720. Baselines of the panel in both themes.
import type { Story } from '../../src/api/types';
import { CO_WRITER_LABELS } from '../../src/features/coWriter/coWriterLabels';
import { STORY_LABELS } from '../../src/features/story/storyLabels';
import { expectPicturesLoaded } from '../support/app';
import { storeFile } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { expectNoPageOverflow } from '../support/shell';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop, intersects } from '../support/visibility';
import { CoWriterDriver, rule } from './coWriterDriver';
import { backendOutput, backendStory, LIGHTHOUSE, StoryDriver } from './storyDriver';

const STORY = LIGHTHOUSE.id;
const MORNING_CALM = LIGHTHOUSE.sceneIds[2];
const OPENING = 'The keeper wakes before dawn. The lamp still turns, and far out at sea a small boat is coming home.';

const HARBOR = rule(
	'harbor',
	{ say: 'I will add the harbor scene after the storm.' },
	{ tool: 'add_scenes', arguments: { story_id: '{context.story_id}', scenes: [{ title: 'The harbor', text: 'Boats rock in the grey light.', extra_tags: ['harbor', 'fishing boats', 'morning'] }] } },
	{ tool: 'update_scenes', arguments: { story_id: '{context.story_id}', changes: [{ scene_id: '{last.scene_id}', text: 'Boats rock in the grey light while gulls circle the harbor.' }] } },
	{ say: 'Done: {last.summary}.' },
);
const ILLUSTRATE = rule(
	'illustrate',
	{ say: 'Generating the picture of Morning calm.' },
	{ tool: 'generate_scenes', arguments: { story_id: STORY, scene_ids: [MORNING_CALM] } },
	{ say: 'Finished: {last.summary}.' },
);

async function open(app: import('../support/app').AppDriver): Promise<{ story: StoryDriver; coWriter: CoWriterDriver }> {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	return { story, coWriter: new CoWriterDriver(story) };
}

test.describe('a streamed answer', () => {
	test.use({ e2eOptions: { codex: { delta_delay_ms: 60, default_steps: [{ say: OPENING }] } } });

	test('streams into the conversation, docked next to the storyboard; Enter sends, Shift+Enter is a new line', async ({ app, page }, testInfo) => {
		const { story, coWriter } = await open(app);
		await coWriter.expectState('ready');
		await expect(coWriter.dock().getByRole('heading', { level: 2, name: CO_WRITER_LABELS.panel })).toBeVisible();
		await expect(coWriter.dock().getByText('Codex 0.169.0-fake · gpt-fake', { exact: true })).toBeVisible();
		await expect(coWriter.log().getByText('Write with Codex', { exact: true })).toBeVisible();
		await expect(coWriter.button(CO_WRITER_LABELS.send)).toBeDisabled();

		// Shift+Enter adds a line, Enter sends.
		await coWriter.messageBox().click();
		await page.keyboard.type('Write the opening.');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('Keep it short.');
		await expect(coWriter.messageBox()).toHaveValue('Write the opening.\nKeep it short.');
		await page.keyboard.press('Enter');
		await expect(coWriter.entries('user')).toHaveText(['Write the opening.\nKeep it short.']);
		await expect(coWriter.messageBox()).toHaveValue('');

		// The answer streams: shown while it grows, then complete.
		const answer = coWriter.entries('assistant').first();
		await expect(answer).toHaveAttribute('aria-busy', 'true');
		await expect(coWriter.button(CO_WRITER_LABELS.stop)).toBeVisible();
		await expect(coWriter.dock().getByText(CO_WRITER_LABELS.working, { exact: true })).toBeVisible();
		const partial = (await answer.textContent()) ?? '';
		expect(partial.length).toBeLessThan(OPENING.length);
		await coWriter.waitForAnswer();
		await expect(answer).toHaveText(OPENING);
		await expect(answer).toHaveAttribute('aria-busy', 'false');

		// Docked: the dock, the details and the scenes tile the section.
		const [scenes, details, dock] = await Promise.all([boxOf(story.scenes()), boxOf(story.details()), boxOf(coWriter.dock())]);
		expect(intersects(scenes, details) || intersects(details, dock)).toBe(false);
		expect(details.x + details.width).toBeLessThanOrEqual(dock.x + 1);
		await expectNoHorizontalOverflow(coWriter.dock());
		await expectNoPageOverflow(page);
		await assertAppVisible(page);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-answer');
		await expectBaseline(coWriter.dock(), 'co-writer-answer.png');
	});
});

const MARKDOWN = [
	'## Plan for the storm',
	'Three **scenes**, one *quiet*:',
	'',
	'1. `The harbor` at dawn',
	'2. The storm',
	'   - lightning, rain',
	'',
	'See [the tag guide](https://example.com/tags). <img src=x onerror=alert(1)>',
	'',
	'```',
	'storm, night, crashing waves',
	'```',
].join(String.fromCharCode(10));

test.describe('Markdown answers', () => {
	test.use({ e2eOptions: { codex: { delta_delay_ms: 5, default_steps: [{ say: MARKDOWN }] } } });

	test('show as formatted text, never as HTML; links open outside the app', async ({ app, page }, testInfo) => {
		const { coWriter } = await open(app);
		await coWriter.send('Plan the storm');
		await coWriter.waitForAnswer();

		const answer = coWriter.entries('assistant').last();
		await expect(answer.getByRole('heading', { level: 3, name: 'Plan for the storm', exact: true })).toBeVisible();
		await expect(answer.locator('strong')).toHaveText('scenes');
		await expect(answer.locator('em')).toHaveText('quiet');
		await expect(answer.locator('ol > li')).toHaveCount(2);
		await expect(answer.locator('ol ul > li')).toHaveText('lightning, rain');
		await expect(answer.locator('p code')).toHaveText('The harbor');
		await expect(answer.locator('pre')).toHaveText('storm, night, crashing waves');
		const link = answer.getByRole('link', { name: 'the tag guide', exact: true });
		await expect(link).toHaveAttribute('href', 'https://example.com/tags');
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(answer).toContainText('<img src=x onerror=alert(1)>');
		await expect(coWriter.dock().locator('img')).toHaveCount(0);
		await expectNoHorizontalOverflow(coWriter.dock());
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-markdown');
		await expectBaseline(coWriter.dock(), 'co-writer-markdown.png');
	});
});

test.describe('tools', () => {
	test.use({ e2eOptions: { codex: { rules: [HARBOR, ILLUSTRATE] } } });

	test('a tool call adds a scene and edits it, shown in the storyboard; its activity links to the scene', async ({ app, page, backend }, testInfo) => {
		const { story, coWriter } = await open(app);
		await coWriter.send('Add a harbor scene after the storm');
		await coWriter.waitForAnswer();

		// The new scene is in the storyboard and in the details, with the edited text and the tags Codex wrote.
		const harbor = story.card(4, 'The harbor');
		await expect(harbor).toBeVisible();
		await expect(harbor).toContainText('Boats rock in the grey light while gulls circle the harbor.');
		const details = story.details();
		await expect(details.getByRole('heading', { level: 2, name: 'The harbor', exact: true })).toBeVisible();
		await expect(details.getByRole('textbox', { name: STORY_LABELS.extraTags, exact: true })).toHaveValue('harbor, fishing boats, morning');
		await expect(coWriter.entries('tool')).toHaveText(['Added Scene 4 · The harborShow', 'Edited Scene 4 · The harbor (text)Show']);
		await expect(coWriter.entries('assistant').last()).toHaveText('Done: Edited Scene 4 · The harbor (text).');
		const saved: Story = await backendStory(backend, STORY);
		expect(saved.scenes.map((scene) => scene.title)).toEqual([...LIGHTHOUSE.scenes, 'The harbor']);
		expect(saved.scenes[3]).toMatchObject({ text: 'Boats rock in the grey light while gulls circle the harbor.', extra_tags: ['harbor', 'fishing boats', 'morning'] });

		// Show goes back to the scene from elsewhere.
		await story.openScene(1, LIGHTHOUSE.scenes[0]);
		await coWriter.showLink('Scene 4 · The harbor').first().click();
		await expect(details.getByRole('heading', { level: 2, name: 'The harbor', exact: true })).toBeVisible();
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-tools');
		await expectBaseline(coWriter.dock(), 'co-writer-tools.png');
	});

	test.describe('with a slower generator', () => {
		test.use({ e2eOptions: { generator: { step_delay_ms: 120 }, codex: { rules: [ILLUSTRATE] } } });

		test('a tool call illustrates a scene with the generator: its progress on the card, then its picture', async ({ app, page, backend }, testInfo) => {
			const { story, coWriter } = await open(app);
			const calm = story.card(3, LIGHTHOUSE.scenes[2]);
			await coWriter.send('Please illustrate Morning calm');

			await expect(story.status(calm)).toHaveText('Generating');
			await expect(coWriter.entries('tool')).toHaveText(['Generating Scene 3 · Morning calm…Show']);
			await saveScreenshot(page, testInfo, 'co-writer-generating');
			await expect(story.status(calm)).toHaveText('Illustrated', { timeout: 30_000 });
			await coWriter.waitForAnswer();
			await expectPicturesLoaded(calm);
			await expect(coWriter.entries('tool')).toHaveText(['Illustrated Scene 3 · Morning calmShow']);
			await expect(coWriter.entries('assistant').last()).toHaveText('Finished: Illustrated Scene 3 · Morning calm.');

			const scene = (await backendStory(backend, STORY)).scenes[2];
			expect(scene.variants).toHaveLength(1);
			const record = await backendOutput(backend, scene.chosen_output_id!);
			expect(record.story).toMatchObject({ story_id: STORY, scene_id: MORNING_CALM });
			expect((await backend.state()).generations).toBe(1);
		});

		test('Stop during a generation started by Codex cancels it', async ({ app, backend }) => {
			const { story, coWriter } = await open(app);
			const calm = story.card(3, LIGHTHOUSE.scenes[2]);
			await coWriter.send('Please illustrate Morning calm');
			await expect(story.status(calm)).toHaveText('Generating');

			await coWriter.button(CO_WRITER_LABELS.stop).click();

			await coWriter.waitForAnswer();
			await expect(story.status(calm)).toHaveText('Not illustrated');
			await expect(coWriter.entries('tool')).toHaveText(['Stopped by the user.Show']);
			await expect(coWriter.entries('notice')).toHaveText(['Stopped.']);
			await expect(coWriter.entries('assistant')).toHaveText(['Generating the picture of Morning calm.']);
			expect((await backendStory(backend, STORY)).scenes[2].variants).toEqual([]);
		});
	});
});

test.describe('Stop', () => {
	test.use({ e2eOptions: { codex: { delta_delay_ms: 250, default_steps: [{ say: Array.from({ length: 60 }, (_unused, index) => `word${index}`).join(' ') }] } } });

	test('Stop ends a long answer where it is; the next message can be sent', async ({ app }) => {
		const { coWriter } = await open(app);
		await coWriter.send('Tell me everything');
		await expect(coWriter.entries('assistant')).toContainText('word2');

		await coWriter.button(CO_WRITER_LABELS.stop).click();

		await coWriter.waitForAnswer();
		await expect(coWriter.entries('notice')).toHaveText(['Stopped.']);
		const words = ((await coWriter.entries('assistant').textContent()) ?? '').split(' ');
		expect(words.length).toBeLessThan(60);
		await expect(coWriter.entries('assistant')).toHaveAttribute('aria-busy', 'false');
		await coWriter.messageBox().fill('Next');
		await expect(coWriter.button(CO_WRITER_LABELS.send)).toBeEnabled();
	});
});

test.describe('Codex not found', () => {
	test.use({ e2eOptions: { codex: { installed: false } } });

	test('says where it looked; the user sets the path of codex.exe and the co-writer is ready', async ({ app, page, backend }, testInfo) => {
		const { coWriter } = await open(app);
		await coWriter.expectState('not_found');
		await expect(coWriter.dock().getByRole('heading', { name: 'Codex was not found', exact: true })).toBeVisible();
		await expect(coWriter.dock().getByRole('list', { name: 'Where the app looked' })).toHaveText('codex on PATH');
		await expect(coWriter.messageBox()).toHaveCount(0);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-not-found');
		await expectBaseline(coWriter.dock(), 'co-writer-not-found.png');

		const { codex_path } = await backend.state();
		await coWriter.dock().getByRole('textbox', { name: CO_WRITER_LABELS.codexPath, exact: true }).fill(codex_path);
		await coWriter.button(CO_WRITER_LABELS.usePath).click();

		await coWriter.expectState('ready');
		await expect(coWriter.messageBox()).toBeVisible();
		const status = await backend.get<{ configured_path: string; source: string }>('/api/codex/status');
		expect(status).toMatchObject({ configured_path: codex_path, source: 'configured' });
	});
});

test.describe('Codex not signed in', () => {
	test.use({ e2eOptions: { codex: { account: null } } });

	test('asks to sign in through the Codex app; Retry once signed in', async ({ app, page, backend }, testInfo) => {
		const { coWriter } = await open(app);
		await coWriter.expectState('signed_out');
		await expect(coWriter.dock().getByRole('heading', { name: 'Sign in to Codex', exact: true })).toBeVisible();
		await expect(coWriter.dock().getByText(/^Codex is not signed in\. Open the OpenAI Codex app/)).toBeVisible();
		await expect(coWriter.dock().getByText('Codex 0.169.0-fake is installed.', { exact: true })).toBeVisible();
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-signed-out');
		await expectBaseline(coWriter.dock(), 'co-writer-signed-out.png');

		await backend.codex({ account: 'chatgpt' });
		await coWriter.button(CO_WRITER_LABELS.retry).click();

		await coWriter.expectState('ready');
		await expect(coWriter.messageBox()).toBeVisible();
	});
});

test.describe('after a reload', () => {
	test.use({ e2eOptions: { codex: { default_steps: [{ say: 'This conversation had {turns} earlier turns.' }] } } });

	test('the conversation is there again and goes on in the same Codex thread', async ({ app, page }) => {
		const { story, coWriter } = await open(app);
		await coWriter.send('First message');
		await coWriter.waitForAnswer();
		await expect(coWriter.entries('assistant')).toHaveText(['This conversation had 0 earlier turns.']);

		await page.reload();
		await expect(app.navigation()).toBeVisible({ timeout: 30_000 });
		await story.open();
		await coWriter.expectState('ready');
		await expect(coWriter.entries('user')).toHaveText(['First message']);
		await expect(coWriter.entries('assistant')).toHaveText(['This conversation had 0 earlier turns.']);

		await coWriter.send('Second message');
		await coWriter.waitForAnswer();
		await expect(coWriter.entries('assistant')).toHaveText(['This conversation had 0 earlier turns.', 'This conversation had 1 earlier turns.']);

		// New conversation: empty, and Codex starts a new thread.
		await coWriter.command(CO_WRITER_LABELS.newConversation).click();
		await expect(coWriter.log().getByText('Write with Codex', { exact: true })).toBeVisible();
		await coWriter.send('Third message');
		await coWriter.waitForAnswer();
		await expect(coWriter.entries('assistant')).toHaveText(['This conversation had 0 earlier turns.']);
	});
});

test.describe('in the smallest window', () => {
	test.use({ viewport: SMALL_VIEWPORT, e2eOptions: { codex: { rules: [HARBOR] } } });

	test('the co-writer fits 1280 x 720 next to the storyboard, and collapses to give the scenes its room', async ({ app, page, backend }, testInfo) => {
		const { story, coWriter } = await open(app);
		await coWriter.send('Add a harbor scene');
		await coWriter.waitForAnswer();
		await expectNoPageOverflow(page);
		await expectNoHorizontalOverflow(coWriter.dock());
		await expectOnTop(coWriter.button(CO_WRITER_LABELS.send));
		await expectOnTop(coWriter.messageBox());
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-1280x720');
		await expectBaseline(page, 'co-writer-1280x720.png');

		// Collapsed: a strip, two card columns; the conversation is kept and the choice is saved.
		const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/api/stores/story-store'));
		await coWriter.command(CO_WRITER_LABELS.collapse).click();
		await expect(coWriter.expand()).toBeFocused();
		expect((await saved).ok()).toBe(true);
		expect(await backend.storedState('story-store')).toEqual({ dockCollapsed: true });
		const strip = await boxOf(coWriter.dock());
		expect(strip.width).toBeLessThanOrEqual(49);
		const [first, second] = [await boxOf(story.card(1, LIGHTHOUSE.scenes[0])), await boxOf(story.card(2, LIGHTHOUSE.scenes[1]))];
		expect(Math.abs(first.y - second.y)).toBeLessThan(2);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'co-writer-collapsed-1280x720');

		await page.reload();
		await expect(app.navigation()).toBeVisible({ timeout: 30_000 });
		await story.open();
		await expect(coWriter.expand()).toBeVisible();
		await coWriter.expand().click();
		await expect(coWriter.dock()).toBeFocused();
		await expect(coWriter.entries('tool')).toHaveCount(2);
	});

	test.describe('collapsed before', () => {
		test.use({ e2eOptions: { files: storeFile('story-store', { dockCollapsed: true }, 0) } });

		test('F6 reaches the strip; Expand shows the panel again', async ({ app, page }) => {
			const { coWriter } = await open(app);
			await expect(coWriter.expand()).toBeVisible();
			for (let press = 0; press < 8 && !(await coWriter.dock().evaluate((element) => element === document.activeElement)); press += 1) {
				await page.keyboard.press('F6');
			}
			await expect(coWriter.dock()).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(coWriter.expand()).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(coWriter.messageBox()).toBeVisible();
			await expect(coWriter.dock()).toBeFocused();
		});
	});
});
