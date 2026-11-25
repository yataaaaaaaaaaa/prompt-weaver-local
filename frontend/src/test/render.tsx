// Component test helper: renders inside the app's real root providers (src/app/AppProviders.tsx: Fluent theme,
// document styles, portal configuration, error boundary) with the theme forced to light for determinism, so every
// component test exercises the provider setup the app ships with.
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { AppProviders } from '../app/AppProviders';
import type { ColorScheme } from '../app/theme';

export type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
	/** Default 'light'. */
	colorScheme?: ColorScheme;
};

export function renderWithProviders(
	ui: ReactElement,
	{ colorScheme = 'light', ...options }: RenderWithProvidersOptions = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
	function Providers({ children }: { children: ReactNode }) {
		return <AppProviders colorScheme={colorScheme}>{children}</AppProviders>;
	}
	return { user: userEvent.setup(), ...render(ui, { wrapper: Providers, ...options }) };
}
