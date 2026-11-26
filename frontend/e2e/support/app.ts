// Page helpers shared by every e2e test: open the app, find its landmarks (the navigation rail, the task sections,
// the Create regions and command bar, the category cards) by the accessible names of src/app/sections.ts, switch
// sections, and wait until the app is settled. Area-specific helpers belong in the area's own spec folder
// (e2e/<area>/), built on these.
import { expect, type Locator, type Page } from '@playwright/test';
import {
	CREATE_REGION_LABELS,
	SECTION_LABELS,
	SHELL_LABELS,
	type CreateRegionId,
	type SectionId,
} from '../../src/app/sections';
import { GENERATION_ACTION_NAMES, GENERATION_LABELS } from '../../src/features/generation/generationLabels';
import { VIEWER_LABELS } from '../../src/features/outputs/viewerLabels';

/** The name of a generation action button ('Generate', 'Generating…', 'Continuous', 'Cancel'). */
export type GenerationActionName = (typeof GENERATION_ACTION_NAMES)[keyof typeof GENERATION_ACTION_NAMES];

export class AppDriver {
	constructor(readonly page: Page) {}

	/** Loads the app (the backend was reset before the test) and waits until the shell is settled. */
	async open(): Promise<void> {
		await this.page.goto('/');
		await expect(this.navigation()).toBeVisible({ timeout: 30_000 });
		await expect(this.section('create')).toBeVisible();
		await this.settle();
	}

	/** Waits for the web fonts and for every picture in view to be loaded (stable screenshots). Pictures out of view
	 *  are not waited for: a lazy thumbnail below the fold of a scrolled panel never loads. */
	async settle(): Promise<void> {
		await waitForPicturesInView(this.page);
	}

	// -- landmarks -------------------------------------------------------------------------------------------------

	/** The navigation rail (<nav>). */
	navigation(): Locator {
		return this.page.getByRole('navigation', { name: SHELL_LABELS.navigation, exact: true });
	}

	/** The rail item of a section (its accessible name is exactly the section's name). */
	navItem(section: SectionId): Locator {
		return this.navigation().getByRole('button', { name: SECTION_LABELS[section], exact: true });
	}

	/** A task section's <main> landmark (only the shown section is visible). */
	section(section: SectionId): Locator {
		return this.page.getByRole('main', { name: SECTION_LABELS[section], exact: true });
	}

	/** A docked region of the Create section ('board' = Prompt board, 'viewer' = Current image, 'generation'). */
	createRegion(region: CreateRegionId): Locator {
		return this.section('create').getByRole('region', { name: CREATE_REGION_LABELS[region], exact: true });
	}

	/** The compact command bar at the top of Create (current model, active character, LoRA count). */
	commandBar(): Locator {
		return this.section('create').getByRole('toolbar', { name: SHELL_LABELS.createCommandBar, exact: true });
	}

	/** The generation actions of the Create section (Generate, Continuous, Cancel and the progress): the sticky action
	 *  area of the generation panel, or the compact actions of its collapsed strip (the hidden one is skipped). */
	generationActions(): Locator {
		return this.createRegion('generation').getByRole('group', { name: GENERATION_LABELS.actions, exact: true });
	}

	/** A generation action button by its exact name. */
	generationAction(name: GenerationActionName = GENERATION_ACTION_NAMES.generate): Locator {
		return this.generationActions().getByRole('button', { name, exact: true });
	}

	/** The 'Layout' toolbar next to the command bar: one toggle per Create region (pressed while expanded) and the
	 *  'Cycle the Create layout' button (Ctrl+H). */
	layoutToolbar(): Locator {
		return this.section('create').getByRole('toolbar', { name: 'Layout', exact: true });
	}

	/** The toggle of a Create region in the 'Layout' toolbar (named after the region). */
	regionToggle(region: CreateRegionId): Locator {
		return this.layoutToolbar().getByRole('button', { name: CREATE_REGION_LABELS[region], exact: true });
	}

	/** The splitter on the start side of the viewer or of the generation panel ('Resize <region>'; aria-valuenow is the
	 *  region's width in px). */
	splitter(region: 'viewer' | 'generation'): Locator {
		return this.section('create').getByRole('separator', { name: `Resize ${CREATE_REGION_LABELS[region]}`, exact: true });
	}

	/** The Expand button of a collapsed Create region's strip. */
	expandButton(region: CreateRegionId): Locator {
		return this.createRegion(region).getByRole('button', { name: `Expand ${CREATE_REGION_LABELS[region]}`, exact: true });
	}

	/** The downloads indicator at the bottom of the rail (its popover lists the running downloads). */
	downloadsButton(): Locator {
		return this.navigation().getByRole('button', { name: 'Downloads', exact: true });
	}

	/** The About button at the bottom of the rail (its popover names the data directory and the backend). */
	aboutButton(): Locator {
		return this.navigation().getByRole('button', { name: 'About', exact: true });
	}

	/** The card of a prompt category on the board, by the category's name (<article aria-label="<name> category">). */
	categoryCard(name: string): Locator {
		return this.createRegion('board').getByRole('article', { name: `${name} category`, exact: true });
	}

	/** The Used sub-prompts list of the viewer (items named '<category>: <sub-prompt>'; the P / C / tag association
	 *  endpoints are their buttons). Call showViewerTab('Used sub-prompts') first. */
	usedSubPrompts(): Locator {
		return this.createRegion('viewer').getByRole('list', { name: VIEWER_LABELS.usedSubPrompts, exact: true });
	}

	/** Selects a tab of the viewer's output details panel, opening the panel first when it is closed (its toggle in the
	 *  viewer is the button 'Output details'). */
	async showViewerTab(tab: 'Details' | 'Used sub-prompts'): Promise<void> {
		const viewer = this.createRegion('viewer');
		const tabElement = viewer.getByRole('tab', { name: tab, exact: true });
		if (!(await tabElement.isVisible())) {
			const toggle = viewer.getByRole('button', { name: VIEWER_LABELS.detailsToggle, exact: true });
			await expect(toggle).toHaveAttribute('aria-pressed', 'false');
			await toggle.click();
		}
		await tabElement.click();
		await expect(tabElement).toHaveAttribute('aria-selected', 'true');
	}

	/** Shows a section through its rail item (when another one is shown), then parks the pointer (no tooltip left)
	 *  and waits for the pictures in view. Returns the section. */
	async goTo(section: SectionId): Promise<Locator> {
		const target = this.section(section);
		if (!(await target.isVisible())) {
			await this.navItem(section).click();
			await expect(target).toBeVisible();
			await this.parkPointer();
		}
		await this.settle();
		return target;
	}

	/** Moves the pointer to a neutral spot and waits until no tooltip is left (Fluent hides one after a delay), so the
	 *  next check or screenshot sees no leftover overlay. `blur` also takes the focus off the focused control (Fluent
	 *  shows the tooltip of a focused or just-clicked control too). */
	async parkPointer({ blur = false }: { blur?: boolean } = {}): Promise<void> {
		const height = this.page.viewportSize()?.height ?? 600;
		// The bottom-start corner of the navigation rail, in the padding under its bottom buttons: never a control, never
		// a tooltip trigger.
		await this.page.mouse.move(1, height - 1);
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

/** The toast whose text matches `text` (one of the Notifications region's message bars); its follow-up action (e.g.
 *  'Go to Create') is one of its buttons. */
export function toast(page: Page, text: string | RegExp): Locator {
	return notifications(page).locator('.fui-MessageBar').filter({ hasText: text });
}

/** Dismisses every toast (before a screenshot of something they could cover). */
export async function dismissNotifications(page: Page): Promise<void> {
	const region = notifications(page);
	while ((await region.count()) > 0 && (await region.getByRole('button', { name: 'Dismiss' }).count()) > 0) {
		await region.getByRole('button', { name: 'Dismiss' }).first().click();
	}
	await expect(region).toHaveCount(0);
}
