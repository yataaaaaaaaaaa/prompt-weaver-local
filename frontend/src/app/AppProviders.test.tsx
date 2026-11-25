import { Button, Tooltip } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from './AppProviders';

function appRootClasses(container: HTMLElement): string[] {
	const root = container.firstElementChild as HTMLElement;
	return root.className.split(/\s+/).filter(Boolean);
}

describe('AppProviders', () => {
	it('does not copy the full-height app root styles onto Fluent portal mount nodes', async () => {
		// Regression: with applyStylesToPortals left on, the portal mount node (absolute, z-index 1000000) received the
		// root's height:100% + opaque background and covered the whole app as soon as any portal existed.
		const { container } = render(
			<AppProviders>
				<Tooltip content="Tip" relationship="label" visible>
					<Button>Anchor</Button>
				</Tooltip>
			</AppProviders>,
		);
		await screen.findByText('Tip');

		const portalMountNodes = Array.from(document.body.children).filter(
			(element): element is HTMLElement => element instanceof HTMLElement && !element.contains(container) && element !== container,
		);
		expect(portalMountNodes.length).toBeGreaterThan(0);

		const rootOnlyClasses = appRootClasses(container).filter((className) => !className.startsWith('fui-FluentProvider'));
		expect(rootOnlyClasses.length).toBeGreaterThan(0);
		for (const node of portalMountNodes) {
			const nodeClasses = node.className.split(/\s+/);
			for (const className of rootOnlyClasses) {
				expect(nodeClasses).not.toContain(className);
			}
		}
	});
});
