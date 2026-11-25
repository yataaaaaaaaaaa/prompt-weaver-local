// "Reorganize categories" (app bar button and Ctrl+O) in the real browser: priorities renumbered 1..n in priority
// order, and the category windows arranged in a grid (rows left to right, top to bottom, in that order) whose
// windows never overlap.
import { expect, test } from '../support/fixtures';
import { FIXTURE_CATEGORIES, savedStore, storeFile, STORE_NAMES } from '../support/backend';
import type { AppDriver } from '../support/app';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, intersects, type Box } from '../support/visibility';
import { windowHandles } from './workspace';

type StoredCategory = { text: string; priority: number };
type StoredCategories = { categories: StoredCategory[] };
type CategoriesEnvelope = { envelope: { state: StoredCategories; version: number } | null };

const priorities = (state: StoredCategories) => state.categories.map((category) => [category.text, category.priority]);

/** The category windows' boxes in `names` order. */
async function categoryBoxes(app: AppDriver, names: readonly string[]): Promise<Box[]> {
	const boxes: Box[] = [];
	for (const name of names) {
		boxes.push(await boxOf(app.categoryWindow(name)));
	}
	return boxes;
}

function expectGrid(boxes: Box[]): void {
	for (let first = 0; first < boxes.length; first += 1) {
		for (let second = first + 1; second < boxes.length; second += 1) {
			expect(intersects(boxes[first], boxes[second]), `category windows ${first} and ${second} overlap`).toBe(false);
		}
	}
	// Reading order: each window is right of the previous one on the same row, or on a lower row.
	for (let index = 1; index < boxes.length; index += 1) {
		const [previous, current] = [boxes[index - 1], boxes[index]];
		const sameRow = Math.abs(previous.y - current.y) < 1;
		expect(sameRow ? current.x > previous.x : current.y > previous.y, `window ${index} follows window ${index - 1}`).toBe(true);
	}
}

test('Reorganize categories renumbers the priorities and arranges the windows in a grid', async ({ app, page, backend }, testInfo) => {
	// Scrambled, sparse priorities: reversed list order, steps of 10.
	const fixture = await backend.get<CategoriesEnvelope>(`/api/stores/${STORE_NAMES.categories}`);
	const state = fixture.envelope!.state as { categories: StoredCategory[] };
	const scrambled = state.categories.map((category, index) => ({ ...category, priority: (state.categories.length - index) * 10 }));
	await backend.reset({ files: storeFile(STORE_NAMES.categories, { ...state, categories: scrambled }, fixture.envelope!.version) });
	const expectedOrder = [...FIXTURE_CATEGORIES].reverse();

	const expectedPriorities = expectedOrder.map((name, index) => [name, index + 1]);
	await app.open();
	const saved = savedStore<StoredCategories>(
		page,
		STORE_NAMES.categories,
		(stored) => JSON.stringify(priorities(stored)) === JSON.stringify(expectedPriorities),
	);
	await app.appBar().getByRole('button', { name: 'Reorganize categories', exact: true }).click();
	await saved;
	expect(priorities(await backend.storedState<StoredCategories>(STORE_NAMES.categories))).toEqual(expectedPriorities);
	for (const [index, name] of expectedOrder.entries()) {
		await expect(app.categoryWindow(name).getByLabel('Priority', { exact: true })).toHaveValue(String(index + 1));
	}
	expectGrid(await categoryBoxes(app, expectedOrder));
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'reorganized');
});

test('Ctrl+O reorganizes the category windows again after one was moved', async ({ app, page }, testInfo) => {
	await app.open();
	await page.keyboard.press('Control+O');
	const arranged = await categoryBoxes(app, FIXTURE_CATEGORIES);
	expectGrid(arranged);

	// Move the first window over the second one with the keyboard, then reorganize with the shortcut.
	const subject = app.categoryWindow('Subject');
	await windowHandles(subject, 'Subject category').move.focus();
	for (let step = 0; step < 4; step += 1) {
		await page.keyboard.press('Shift+ArrowRight');
	}
	await expect.poll(async () => intersects(await boxOf(subject), await boxOf(app.categoryWindow('Outfit')))).toBe(true);
	await app.workspace().click({ position: { x: 4, y: 4 } });
	await page.keyboard.press('Control+O');
	await expect.poll(async () => (await boxOf(subject)).x).toBeCloseTo(arranged[0].x, 0);
	expectGrid(await categoryBoxes(app, FIXTURE_CATEGORIES));
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'reorganized-with-shortcut');
});
