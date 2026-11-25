// Smoke tests of the shared test infrastructure (Fluent in jsdom, store reset between tests).
import { Button, Dialog, DialogBody, DialogSurface, DialogTitle, DialogTrigger, Tooltip, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNotificationsStore } from '../stores/notificationsStore';
import { renderWithProviders } from './render';

/** Every CSS rule currently inserted in the document (Fluent inserts the theme variables through the CSSOM). */
function insertedCss(): string {
	return Array.from(document.styleSheets)
		.flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
		.join(' ');
}

describe('test infrastructure', () => {
	it('renders Fluent components and dialogs in jsdom', async () => {
		const { user } = renderWithProviders(
			<Dialog>
				<DialogTrigger disableButtonEnhancement>
					<Tooltip content="Opens the dialog" relationship="description">
						<Button>Open</Button>
					</Tooltip>
				</DialogTrigger>
				<DialogSurface>
					<DialogBody>
						<DialogTitle>Hello</DialogTitle>
					</DialogBody>
				</DialogSurface>
			</Dialog>,
		);

		await user.click(screen.getByRole('button', { name: 'Open' }));

		expect(await screen.findByRole('dialog')).toHaveTextContent('Hello');
	});

	it('renders through the real AppProviders with the forced color scheme', () => {
		const light = renderWithProviders(<span>content</span>);
		const lightRoot = light.container.firstElementChild as HTMLElement;
		expect(lightRoot).toHaveClass('fui-FluentProvider');
		expect(lightRoot.textContent).toBe('content');
		expect(insertedCss()).toContain(`--colorNeutralBackground2: ${webLightTheme.colorNeutralBackground2}`);
		light.unmount();

		const dark = renderWithProviders(<span>content</span>, { colorScheme: 'dark' });
		expect(dark.container.firstElementChild).toHaveClass('fui-FluentProvider');
		expect(insertedCss()).toContain(`--colorNeutralBackground2: ${webDarkTheme.colorNeutralBackground2}`);
	});

	it('lets a test mutate a store...', () => {
		useNotificationsStore.getState().notify('error', 'boom');
		expect(useNotificationsStore.getState().notifications).toHaveLength(1);
	});

	it('...and resets every store before the next test', () => {
		expect(useNotificationsStore.getState().notifications).toHaveLength(0);
	});
});
