// Toasts (NotificationsHost) in the real browser: a failed save of the workspace layout shows the 'Saving failed'
// error toast at the bottom-end corner, above every window, never over the app bar, until it is dismissed.
import { tokens } from '@fluentui/react-theme';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop, intersects } from '../support/visibility';
import { windowHandles } from './workspace';

const FAILURE_DETAIL = 'The disk is full (e2e).';

test('a failed save shows the "Saving failed" toast above the windows until it is dismissed', async ({ app, page, diagnostics }, testInfo) => {
	await app.open();
	// The browser logs the failed request itself.
	diagnostics.allow(/status of 500/);
	await page.route('**/api/stores/workspace-store', (route) =>
		route.request().method() === 'PUT'
			? route.fulfill({
					status: 500,
					contentType: 'application/json',
					// The backend is another origin than the page (like the real backend's CORS answer).
					headers: { 'access-control-allow-origin': '*' },
					body: JSON.stringify({ detail: FAILURE_DETAIL }),
				})
			: route.fallback(),
	);

	// Move a window: its new layout cannot be saved.
	const move = windowHandles(app.categoryWindow('Sea creatures'), 'Sea creatures category').move;
	await move.focus();
	await page.keyboard.press('ArrowLeft');

	const notifications = page.getByRole('region', { name: 'Notifications' });
	const toast = notifications.getByRole('group').filter({ hasText: 'Saving failed' });
	await expect(toast).toBeVisible();
	await expect(toast).toContainText(`Changes to 'workspace-store' could not be saved: ${FAILURE_DETAIL}`);
	await expectOnTop(toast);
	// The error intent shows (Fluent status danger colors), not a neutral bar.
	expect(await computedStyle(toast, 'background-color')).toBe(await resolveColor(page, tokens.colorStatusDangerBackground1));
	expect(await computedStyle(toast, 'border-top-color')).toBe(await resolveColor(page, tokens.colorStatusDangerBorder1));
	await app.parkPointer({ blur: true });
	await assertAppVisible(page, { allowOverlays: true });

	// Bottom-end corner: over the windows, never over the app bar.
	const [toastBox, barBox, viewport] = [await boxOf(toast), await boxOf(app.appBar()), page.viewportSize()!];
	expect(intersects(toastBox, barBox), 'the toast covers the app bar').toBe(false);
	expect(toastBox.x + toastBox.width).toBeGreaterThan(viewport.width - 48);
	expect(toastBox.y + toastBox.height).toBeGreaterThan(viewport.height - 48);

	// Saving again (the error repeats) keeps one toast, not a pile.
	await move.focus();
	await page.keyboard.press('ArrowLeft');
	await expect(notifications.getByRole('group')).toHaveCount(1);
	await app.parkPointer({ blur: true });

	await saveScreenshot(page, testInfo, 'saving-failed-toast');
	await expectBaseline(toast, 'toast-error.png');

	await toast.getByRole('button', { name: 'Dismiss' }).click();
	await expect(toast).toHaveCount(0);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
});
