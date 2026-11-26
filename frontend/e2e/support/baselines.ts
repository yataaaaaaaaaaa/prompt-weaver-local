// Visual regression baselines (committed under e2e/__screenshots__/<spec>/<project>/<name>.png; rewritten by
// `npm run test:e2e:update`, then LOOK at every changed PNG before committing). Always go through
// expectBaseline(): it masks the content that legitimately changes between runs (VOLATILE below) on top of the
// caller's own masks, so baselines are stable on any port pair and any machine run.
import { expect, type Locator, type Page } from '@playwright/test';

/** Content that differs between runs: the data directory (a temp dir per run and reset) and the backend address (its
 *  port), both in the rail's About popover. Add new volatile content here, once, instead of masking it in every
 *  test. */
function volatileLocators(page: Page): Locator[] {
	return [page.getByText(/^Data directory:/), page.getByText(/^Backend:/)];
}

export type BaselineOptions = {
	/** Extra masks of this baseline (progress percentages, relative times, ...). */
	mask?: Locator[];
	/** Tolerance override (default: SHARED_CONFIG.expect.toHaveScreenshot in env.ts). */
	maxDiffPixelRatio?: number;
};

/** expect(target).toHaveScreenshot(name) with the volatile content masked. */
export async function expectBaseline(target: Page | Locator, name: string, options: BaselineOptions = {}): Promise<void> {
	const page = 'page' in target && typeof target.page === 'function' ? target.page() : (target as Page);
	await expect(target).toHaveScreenshot(name, {
		mask: [...volatileLocators(page), ...(options.mask ?? [])],
		...(options.maxDiffPixelRatio === undefined ? {} : { maxDiffPixelRatio: options.maxDiffPixelRatio }),
	});
}
