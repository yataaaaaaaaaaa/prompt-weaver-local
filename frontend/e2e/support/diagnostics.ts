// Console errors and uncaught page errors fail the test (fixtures.ts attaches this to every page and Electron
// window before the first navigation and checks it when the test ends). A test that triggers an error on purpose
// declares it with allow(pattern).
import { expect, type ConsoleMessage, type Page } from '@playwright/test';

export class PageDiagnostics {
	private readonly problems: string[] = [];
	private readonly allowed: RegExp[] = [];

	constructor(page: Page) {
		page.on('console', (message: ConsoleMessage) => {
			if (message.type() === 'error') {
				const location = message.location();
				this.record(`console.error: ${message.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ''}`);
			}
		});
		page.on('pageerror', (error) => this.record(`uncaught page error: ${error.stack ?? error.message}`));
		page.on('crash', () => this.record('the page crashed'));
	}

	/** Errors matching `pattern` are expected by this test (e.g. a failing request it provokes). */
	allow(pattern: RegExp): void {
		this.allowed.push(pattern);
	}

	/** Problems seen so far that no allow() pattern matches. */
	unexpected(): string[] {
		return this.problems.filter((problem) => !this.allowed.some((pattern) => pattern.test(problem)));
	}

	/** Fails when an unexpected console error or page error happened. */
	expectClean(): void {
		expect(this.unexpected(), 'console errors / page errors').toEqual([]);
	}

	private record(problem: string): void {
		this.problems.push(problem);
	}
}
