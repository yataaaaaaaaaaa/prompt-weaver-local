// Page helpers shared by every e2e test: open the app, find its windows and controls by their accessible names,
// wait until it is settled. Area-specific helpers belong in the area's own spec folder (e2e/<area>/), built on
// these.
import { expect, type Locator, type Page } from '@playwright/test';

export class AppDriver {
	constructor(readonly page: Page) {}

	/** Loads the app (the backend was reset before the test) and waits until the workspace is settled. */
	async open(): Promise<void> {
		await this.page.goto('/');
		await expect(this.workspace()).toBeVisible({ timeout: 30_000 });
		await this.settle();
	}

	/** Waits for the web fonts and for every picture in view to be loaded (stable screenshots). Pictures out of view
	 *  are not waited for: a lazy thumbnail below the fold of a scrolled pane never loads. */
	async settle(): Promise<void> {
		await waitForPicturesInView(this.page);
	}

	/** The surface holding every window. */
	workspace(): Locator {
		return this.page.getByRole('main', { name: 'Workspace windows' });
	}

	/** The top app bar. */
	appBar(): Locator {
		return this.page.getByRole('toolbar', { name: 'Workspace' });
	}

	/** A workspace window (FloatingPane: a <section> directly on the surface) by its accessible name. Never a
	 *  region nested inside a window, even one with the same name. */
	window(name: string): Locator {
		return this.workspace().locator(`:scope > section[aria-label=${JSON.stringify(name)}]`);
	}

	/** A registered pane window by its title (paneRegistry.tsx), e.g. 'Generation', 'Model library'. */
	pane(title: string): Locator {
		return this.window(title);
	}

	/** The window of a prompt category by the category's name. */
	categoryWindow(name: string): Locator {
		return this.window(`${name} category`);
	}

	/** The app bar toggle showing / hiding a pane. */
	paneToggle(title: string): Locator {
		return this.appBar().getByRole('button', { name: title, exact: true });
	}

	/** Shows the pane (app bar toggle) when hidden and brings it to the front; then parks the pointer (no toggle
	 *  tooltip left) and waits for the pictures in view. */
	async showPane(title: string): Promise<Locator> {
		const pane = this.pane(title);
		if (!(await pane.isVisible())) {
			await this.paneToggle(title).click();
			await expect(pane).toBeVisible();
			await this.parkPointer();
		}
		await this.bringToFront(pane);
		await this.settle();
		return pane;
	}

	/** Brings a window to the front: a pointer down on the window itself (FloatingPane focuses the window on any
	 *  pointer down inside it), without focusing a control or opening a tooltip. */
	async bringToFront(window: Locator): Promise<void> {
		await window.dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true });
		await window.dispatchEvent('pointerup', { button: 0, pointerId: 1, isPrimary: true });
	}

	/** Moves the pointer to a neutral spot of the surface and waits until no tooltip is left (Fluent hides one after a
	 *  delay), so the next check or screenshot sees no leftover overlay. `blur` also takes the focus off the focused
	 *  control (Fluent shows the tooltip of a focused or just-clicked control too). */
	async parkPointer({ blur = false }: { blur?: boolean } = {}): Promise<void> {
		await this.page.mouse.move(1, (this.page.viewportSize()?.height ?? 600) - 1);
		if (blur) {
			await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		}
		await expect(this.page.getByRole('tooltip')).toHaveCount(0);
	}
}

/** Waits for the web fonts and for every <img> visible in the viewport (clipped by its scrolled ancestors) to be
 *  loaded. */
export async function waitForPicturesInView(page: Page): Promise<void> {
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	await page.waitForFunction(() => {
		const inView = (element: Element): boolean => {
			const rect = element.getBoundingClientRect();
			let top = Math.max(rect.top, 0);
			let left = Math.max(rect.left, 0);
			let bottom = Math.min(rect.bottom, window.innerHeight);
			let right = Math.min(rect.right, window.innerWidth);
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				const style = getComputedStyle(parent);
				if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
					const clip = parent.getBoundingClientRect();
					top = Math.max(top, clip.top);
					left = Math.max(left, clip.left);
					bottom = Math.min(bottom, clip.bottom);
					right = Math.min(right, clip.right);
				}
			}
			return bottom > top && right > left;
		};
		return Array.from(document.images).every((image) => image.complete || !inView(image));
	});
}

/** Every picture in view inside `scope` decoded into a real picture (no broken image). */
export async function expectPicturesLoaded(scope: Locator): Promise<void> {
	await waitForPicturesInView(scope.page());
	const broken = await scope.evaluate((root) =>
		Array.from(root.querySelectorAll('img'))
			.filter((image) => image.complete && image.getBoundingClientRect().height > 0 && image.naturalWidth === 0)
			.map((image) => image.src),
	);
	expect(broken, 'pictures that failed to load').toEqual([]);
}

/** The toasts region (NotificationsHost; present while a toast is shown). */
export function notifications(page: Page): Locator {
	return page.getByRole('region', { name: 'Notifications' });
}

/** Dismisses every toast (before a screenshot of something they could cover). */
export async function dismissNotifications(page: Page): Promise<void> {
	const region = notifications(page);
	while ((await region.count()) > 0 && (await region.getByRole('button', { name: 'Dismiss' }).count()) > 0) {
		await region.getByRole('button', { name: 'Dismiss' }).first().click();
	}
	await expect(region).toHaveCount(0);
}
