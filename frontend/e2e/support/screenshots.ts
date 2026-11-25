// Screenshots for people and agents to LOOK at (Read the PNG): saved under e2e/.screens (gitignored) as
// <project>/<spec path>/<test title>--<name>.png, the path printed to the test output. Visual baselines are a
// different thing: expect(...).toHaveScreenshot() (committed under e2e/__screenshots__).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { E2E_DIR, SCREENS_DIR } from './env';
import { expectNotUniform } from './visibility';

function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

/** Path of the screenshot `name` of the running test. */
export function screenshotPath(testInfo: TestInfo, name: string): string {
	const spec = path.relative(E2E_DIR, testInfo.file).replace(/\.spec\.ts$/, '').split(path.sep).join('__');
	return path.join(SCREENS_DIR, testInfo.project.name || 'default', spec, `${slug(testInfo.title)}--${slug(name)}.png`);
}

/** Saves a screenshot of the page (full viewport) or of one element, attaches it to the report and returns its
 *  absolute path. Fails when it is (nearly) uniform, unless `allowUniform` (a deliberately plain element). */
export async function saveScreenshot(
	target: Page | Locator,
	testInfo: TestInfo,
	name: string,
	{ allowUniform = false }: { allowUniform?: boolean } = {},
): Promise<string> {
	const file = screenshotPath(testInfo, name);
	mkdirSync(path.dirname(file), { recursive: true });
	const png = await target.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
	await testInfo.attach(name, { path: file, contentType: 'image/png' });
	console.log(`[screenshot] ${file}`);
	if (!allowUniform) {
		expectNotUniform(png, `screenshot '${name}'`);
	}
	return file;
}
